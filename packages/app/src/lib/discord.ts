/**
 * Discord へのお知らせ送信(ゼロ依存)。
 *
 * - DM: Bot トークンで対象ユーザーとの DM チャンネルを開いて送信。
 *   Discord の仕様上、Bot と共通のサーバーに居ないユーザーには届かない
 *   (その場合 API がエラーを返すので、呼び出し側はメール等に任せる)。
 * - Webhook: グループが設定したチャンネルへ告知を投稿する。
 */
const API = 'https://discord.com/api/v10';

/** Bot トークンで DM チャンネルを開き、その ID を返す */
async function openDmChannel(botToken: string, userId: string): Promise<string | null> {
  const res = await fetch(`${API}/users/@me/channels`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${botToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!res.ok) {
    // 原因の切り分けのため Discord の応答をそのまま残す
    // 401=トークン不正 / 403=権限 or 共通サーバー無し / 50007=DM 拒否
    const detail = await res.text().catch(() => '');
    console.error(`[discord] DM チャンネルを開けません status=${res.status} body=${detail.slice(0, 300)}`);
    return null;
  }
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}

/** Discord ユーザーへ DM を送る。送れたら true */
export async function sendDiscordDm(
  botToken: string,
  userId: string,
  content: string,
): Promise<boolean> {
  try {
    const channelId = await openDmChannel(botToken, userId);
    if (!channelId) return false;
    const res = await fetch(`${API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${botToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[discord] DM 送信に失敗 status=${res.status} body=${detail.slice(0, 300)}`);
    }
    return res.ok;
  } catch (err) {
    console.error('[discord] DM 送信に失敗:', err);
    return false;
  }
}

/** Discord の ID(snowflake)の形式か。ユーザー入力の素朴な検証に使う */
export function isDiscordSnowflake(id: string): boolean {
  return /^\d{17,20}$/.test(id);
}

/**
 * Bot が参加しているサーバーの情報を取得する。
 * サーバー ID の設定時に「Bot が居るか」を確かめるために使う。
 * Bot が未参加なら Discord は 404 を返すので null になる。
 */
export async function fetchDiscordGuild(
  botToken: string,
  guildId: string,
): Promise<{ id: string; name: string } | null> {
  if (!isDiscordSnowflake(guildId)) return null;
  try {
    const res = await fetch(`${API}/guilds/${guildId}`, {
      headers: { authorization: `Bot ${botToken}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(
        `[discord] サーバー情報を取得できません status=${res.status} body=${detail.slice(0, 300)}`,
      );
      return null;
    }
    const data = (await res.json()) as { id?: string; name?: string };
    return data.id ? { id: data.id, name: data.name ?? data.id } : null;
  } catch (err) {
    console.error('[discord] サーバー情報の取得に失敗:', err);
    return null;
  }
}

/**
 * ユーザーがサーバーのメンバーかを確かめる。
 *
 * `GET /guilds/{id}/members/{user}` は Bot がそのサーバーに参加していれば
 * 特権インテント無しで使える。判定できなかった場合は 'error' を返し、
 * 呼び出し側が安全側(参加を許さない)に倒せるようにする。
 */
export async function checkDiscordGuildMember(
  botToken: string,
  guildId: string,
  userId: string,
): Promise<'member' | 'not_member' | 'error'> {
  if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(userId)) return 'error';
  try {
    const res = await fetch(`${API}/guilds/${guildId}/members/${userId}`, {
      headers: { authorization: `Bot ${botToken}` },
    });
    if (res.ok) return 'member';
    // 404 は「メンバーでない」か「Bot がそのサーバーに居ない」。
    // 後者は運営の設定ミスなので、判別のためログに残す。
    if (res.status === 404) return 'not_member';
    const detail = await res.text().catch(() => '');
    console.error(
      `[discord] メンバー確認に失敗 status=${res.status} guild=${guildId} body=${detail.slice(0, 300)}`,
    );
    return 'error';
  } catch (err) {
    console.error('[discord] メンバー確認に失敗:', err);
    return 'error';
  }
}

/** Webhook URL の形式が Discord のものか(SSRF 対策に厳格に判定) */
export function isDiscordWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      (u.hostname === 'discord.com' || u.hostname === 'discordapp.com') &&
      u.pathname.startsWith('/api/webhooks/')
    );
  } catch {
    return false;
  }
}

/** Webhook でチャンネルへ投稿する。成功なら true */
export async function sendDiscordWebhook(
  webhookUrl: string,
  content: string,
): Promise<boolean> {
  if (!isDiscordWebhookUrl(webhookUrl)) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: content.slice(0, 2000),
        // メンションの暴発を防ぐ(@everyone / @here / ロール)
        allowed_mentions: { parse: [] },
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('[discord] Webhook 送信に失敗:', err);
    return false;
  }
}
