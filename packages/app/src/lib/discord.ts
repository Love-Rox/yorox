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
  if (!res.ok) return null;
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
    return res.ok;
  } catch (err) {
    console.error('[discord] DM 送信に失敗:', err);
    return false;
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
