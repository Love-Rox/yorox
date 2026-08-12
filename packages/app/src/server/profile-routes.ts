/**
 * プロフィール編集(本人)とプロフィール URL のエンドポイント。
 */
import { and, eq, isNull } from 'drizzle-orm';
import { generateToken } from '../lib/token';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb, schema } from '../db/client';
import { createAccessToken, revokeAccessToken } from '../domain/access-token';
import { deleteAccount, exportUserData } from '../domain/account';
import { escapeHtml } from '../lib/html';
import { isDiscordWebhookUrl, sendDiscordDm, sendDiscordWebhook } from '../lib/discord';
import { NOTIFICATION_CATEGORIES, parseNotificationPrefs } from '../domain/notification-prefs';
import { buildActorOgSvg } from '../lib/ogp';
import { ulid } from '../lib/ulid';
import { renderOgPngResponse } from './og';
import { confirmEmailChange, requestEmailChange } from '../auth/email-change';
import { followActor, unfollowActor } from '../domain/follow';
import { clearSessionCookieHeader } from '../auth/session';
import { createDirectSender } from '../mail/send';
import { getStorage, getUploadConfig, IMAGE_TYPES } from '../storage/driver';
import {
  claimBluesky,
  claimByRelMe,
  generateClaimCode,
  listClaimedAliases,
  unlinkRemoteAlias,
} from './claim';
import { isSecureRequest } from './http';
import { getSessionActorId } from './route-auth';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

function assertSameOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  return origin === new URL(c.req.url).origin;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

const profile = new Hono();

/** /@handle → /u/handle(URL-DESIGN の人間向け表記) */
profile.get('/:atHandle{@[a-z0-9-]+}', (c) => {
  return c.redirect(`/u/${c.req.param('atHandle').slice(1)}`, 302);
});

/** ユーザーの OGP 画像(PNG)。og-renderer に委譲し R2 キャッシュ */
profile.get('/u/:handle/ogp.png', async (c) => {
  const env = await getEnv();
  const db = createDb(env.DB);
  const handle = c.req.param('handle');
  const actor = await db.query.actors.findFirst({
    where: and(
      eq(schema.actors.handle, handle),
      isNull(schema.actors.domain),
      eq(schema.actors.kind, 'user'),
    ),
  });
  if (!actor) return c.notFound();
  const svg = buildActorOgSvg({
    name: actor.displayName,
    handle,
    kindLabel: '個人',
    subtitle: actor.summary ? actor.summary.replace(/[#*_`>-]/g, '').slice(0, 60) : null,
  });
  const cacheKey = `og-cache/u-${actor.id}-${actor.updatedAt.getTime()}.png`;
  return (await renderOgPngResponse(env, cacheKey, svg)) ?? c.notFound();
});

/** プロフィール更新(表示名・自己紹介・リンク) */
profile.post('/profile/update', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const form = await c.req.parseBody();
  const displayName = str(form.display_name);
  if (!displayName) {
    return c.redirect('/settings/profile?error=invalid_input', 302);
  }

  const links = [str(form.link1), str(form.link2), str(form.link3)]
    .filter((u) => /^https?:\/\//.test(u))
    .slice(0, 3);

  await db
    .update(schema.actors)
    .set({
      displayName,
      summary: str(form.summary) || null,
      profileLinks: links.length > 0 ? links : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.actors.id, actorId));

  // 個人グループの表示名も追従させる(handle 共有ペア)
  const me = await db.query.actors.findFirst({ where: eq(schema.actors.id, actorId) });
  if (me?.handle) {
    await db
      .update(schema.actors)
      .set({ displayName, updatedAt: new Date() })
      .where(
        and(
          eq(schema.actors.handle, me.handle),
          isNull(schema.actors.domain),
          eq(schema.actors.kind, 'group'),
        ),
      );
  }

  return c.redirect('/settings/profile', 302);
});

/** アバター画像のアップロード */



/** 参加予定カレンダー(ics)購読トークンの発行・再発行 */
profile.post('/profile/calendar-token', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  await db
    .update(schema.users)
    .set({ calendarToken: generateToken() })
    .where(eq(schema.users.actorId, actorId));
  return c.redirect('/settings/profile?cal_saved=1#calendar', 302);
});

/** 自分の全データを JSON でエクスポート(ダウンロード) */
profile.get('/profile/export.json', async (c) => {
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const data = await exportUserData(db, actorId);
  return c.body(JSON.stringify(data, null, 2), 200, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': 'attachment; filename="yorox-account-export.json"',
    'cache-control': 'private, no-store',
  });
});

/** アカウント削除(退会) */
profile.post('/profile/delete', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  // 確認入力(「退会」と入力)を必須にして誤操作を防ぐ
  const form = await c.req.parseBody();
  if (str(form.confirm) !== '退会') {
    return c.redirect('/settings/profile?error=delete_confirm#danger', 302);
  }

  const result = await deleteAccount(db, actorId);
  if (!result.ok) {
    const names = result.groups.map((g) => g.handle ?? g.displayName).join(', ');
    return c.redirect(
      `/settings/profile?error=delete_owner&groups=${encodeURIComponent(names)}#danger`,
      302,
    );
  }

  // セッション cookie を破棄してトップへ
  c.header('set-cookie', clearSessionCookieHeader(await isSecureRequest(c)));
  return c.redirect('/?goodbye=1', 302);
});

/** back パラメータの安全な行き先(オープンリダイレクト防止に同一サイトのパスのみ) */
function safeBackPath(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  // バックスラッシュはブラウザが / に正規化するため //evil.com への
  // スキーム相対リダイレクトに使える。制御文字ごと弾く。
  if (s.includes('\\') || /[\x00-\x1f]/.test(s)) return '/';
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
}

/** フォロー(ローカルのユーザー/グループ) */
profile.post('/follow/:actorId', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const form = await c.req.parseBody();
  try {
    await followActor(db, actorId, c.req.param('actorId'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'フォローできませんでした';
    return c.redirect(`${safeBackPath(form.back)}?error=${encodeURIComponent(message)}`, 302);
  }
  return c.redirect(safeBackPath(form.back), 302);
});

/** フォロー解除 */
profile.post('/unfollow/:actorId', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const form = await c.req.parseBody();
  await unfollowActor(db, actorId, c.req.param('actorId'));
  return c.redirect(safeBackPath(form.back), 302);
});

/** メールアドレス変更の確認ページ(GET でトークンを消費しないための緩衝) */
function confirmEmailChangePage(token: string): string {
  const safe = token.replace(/[^A-Za-z0-9_-]/g, '');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>メールアドレスの変更 - Yorox</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4efde;color:#1b2240;font-family:system-ui,sans-serif;padding:2rem}
@media(prefers-color-scheme:dark){body{background:#12162b;color:#efe9d6}}
.card{text-align:center;max-width:22rem}button{margin-top:1rem;padding:.7rem 2rem;font-weight:700;font-size:1rem;cursor:pointer;background:#1b2240;color:#f4efde;border:none}
p{font-size:.9rem;opacity:.75}</style></head>
<body><form class="card" method="post" action="/profile/email/confirm">
<input type="hidden" name="token" value="${safe}">
<h1>メールアドレスの変更</h1>
<p>下のボタンを押すと、ログイン用メールアドレスがこのメールの届いたアドレスに変わります。</p>
<button type="submit">変更を確定する</button>
</form></body></html>`;
}

/** メールアドレスの変更申請(新アドレスへ確認リンクを送る) */
profile.post('/profile/email/change', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const env = await getEnv();
  const db = createDb(env.DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const form = await c.req.parseBody();
  const result = await requestEmailChange(db, createDirectSender(env), {
    actorId,
    newEmail: str(form.new_email),
    origin: new URL(c.req.url).origin,
  });
  if (!result.ok) {
    const message =
      result.reason === 'taken'
        ? 'そのメールアドレスは既に使われています'
        : result.reason === 'same'
          ? '現在のメールアドレスと同じです'
          : 'メールアドレスの形式を確認してください';
    return c.redirect(`/settings/profile?email_error=${encodeURIComponent(message)}#oauth`, 302);
  }
  return c.redirect('/settings/profile?email_sent=1#oauth', 302);
});

/** メールアドレス変更の確認(メール内リンク) */
profile.get('/profile/email/confirm', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.redirect('/settings/profile?email_error=invalid#oauth', 302);
  return c.html(confirmEmailChangePage(token));
});

profile.post('/profile/email/confirm', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const form = await c.req.parseBody();
  const token = typeof form.token === 'string' ? form.token : '';
  const applied = token ? await confirmEmailChange(db, token) : null;
  if (!applied) {
    return c.redirect(
      `/settings/profile?email_error=${encodeURIComponent('リンクが無効か期限切れです。もう一度お試しください')}#oauth`,
      302,
    );
  }
  return c.redirect('/settings/profile?email_changed=1#oauth', 302);
});

/** 連携アカウントをプロフィールに表示するかの切り替え(本人のみ・Google 不可) */
profile.post('/profile/oauth/:id/visibility', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const row = await db.query.oauthAccounts.findFirst({
    where: and(
      eq(schema.oauthAccounts.id, c.req.param('id')),
      eq(schema.oauthAccounts.userActorId, actorId),
    ),
  });
  if (!row) return c.notFound();
  // Google の label はメールアドレスなので公開させない
  if (row.provider === 'google') return c.text('この連携は公開できません', 400);

  const form = await c.req.parseBody();
  await db
    .update(schema.oauthAccounts)
    .set({ public: form.public === 'on' })
    .where(eq(schema.oauthAccounts.id, row.id));
  return c.redirect('/settings/profile#oauth', 302);
});

/** お知らせ受け取り設定 */
profile.post('/profile/notifications', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const form = await c.req.parseBody();
  // Discord Webhook は形式が正しいときだけ保存(SSRF 対策)
  const webhook = str(form.discord_webhook_url);
  // 種別 × チャンネルのマトリクスを読む
  const prefs = parseNotificationPrefs((field) => form[field] !== undefined);
  // 連携 Fediverse 通知の宛先(本人の claim 済みエイリアスに限定して受理)
  const aliases = await listClaimedAliases(db, actorId);
  const apTargets = aliases.map((a) => a.id).filter((id) => form[`ap_target_${id}`] !== undefined);
  // 従来のトグル(既定値・エクスポート表示用)はマトリクスの要約として同期する
  const anyEmail = NOTIFICATION_CATEGORIES.some((c) => prefs[c.key]?.email);
  const anyDiscordDm = NOTIFICATION_CATEGORIES.some((c) => prefs[c.key]?.discordDm);
  await db
    .update(schema.users)
    .set({
      emailNotifications: anyEmail,
      discordDmNotifications: anyDiscordDm,
      discordWebhookUrl: webhook && isDiscordWebhookUrl(webhook) ? webhook : null,
      notificationPrefs: prefs,
      notifyApTargets: apTargets,
    })
    .where(eq(schema.users.actorId, actorId));
  return c.redirect('/settings/profile?notify_saved=1#notifications', 302);
});


/** Discord 通知のテスト送信(設定画面から即時に結果を確認する) */
profile.post('/profile/discord/test', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const env = await getEnv();
  const db = createDb(env.DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const user = await db.query.users.findFirst({
    where: eq(schema.users.actorId, actorId),
  });
  const link = await db.query.oauthAccounts.findFirst({
    where: and(
      eq(schema.oauthAccounts.userActorId, actorId),
      eq(schema.oauthAccounts.provider, 'discord'),
    ),
  });

  const content = '**[Yorox] テスト送信**\nこのメッセージが届いていれば、Discord への通知は正常に設定されています。';
  const results: string[] = [];

  // DM
  if (!link) {
    results.push('DM: Discord アカウントが未連携です');
  } else if (!user?.discordDmNotifications) {
    results.push('DM: この設定がオフです');
  } else if (!env.DISCORD_BOT_TOKEN) {
    results.push('DM: このインスタンスでは Bot が未設定です');
  } else {
    const ok = await sendDiscordDm(env.DISCORD_BOT_TOKEN, link.providerUserId, content);
    results.push(
      ok
        ? 'DM: 送信しました'
        : 'DM: 送信できませんでした(Bot と共通のサーバーに参加しているか確認してください)',
    );
  }

  // 個人 Webhook
  if (user?.discordWebhookUrl) {
    const ok = await sendDiscordWebhook(user.discordWebhookUrl, content);
    results.push(ok ? 'Webhook: 送信しました' : 'Webhook: 送信できませんでした(URL を確認してください)');
  }

  return c.redirect(
    `/settings/profile?discord_test=${encodeURIComponent(results.join(' / '))}#notifications`,
    302,
  );
});

/** claim: ワンタイムコード発行 */
profile.post('/profile/claim-code', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const code = await generateClaimCode(db, actorId);
  return c.redirect(`/settings/profile?claim_code=${encodeURIComponent(code)}#fediverse`, 302);
});

/** claim: rel=me 確認 */
profile.post('/profile/claim-relme', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const me = await db.query.actors.findFirst({ where: eq(schema.actors.id, actorId) });
  if (!me?.handle) return c.redirect('/settings/profile', 302);

  const form = await c.req.parseBody();
  const remoteRef = str(form.remote_account);
  const origin = new URL(c.req.url).origin;
  const result = await claimByRelMe(db, actorId, remoteRef, [
    `${origin}/u/${me.handle}`,
    `${origin}/@${me.handle}`,
  ]);
  if (result.ok) {
    return c.redirect('/settings/profile?claim_ok=1#fediverse', 302);
  }
  return c.redirect(
    `/settings/profile?claim_error=${encodeURIComponent(result.reason)}#fediverse`,
    302,
  );
});


/** claim: Bluesky アカウント連携 */
profile.post('/profile/claim-bsky', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const me = await db.query.actors.findFirst({ where: eq(schema.actors.id, actorId) });
  if (!me?.handle) return c.redirect('/settings/profile', 302);

  const form = await c.req.parseBody();
  const origin = new URL(c.req.url).origin;
  const result = await claimBluesky(db, actorId, str(form.bsky_handle), [
    `${origin}/u/${me.handle}`,
    `${origin}/@${me.handle}`,
  ]);
  if (result.ok) {
    return c.redirect('/settings/profile?claim_ok=1#fediverse', 302);
  }
  return c.redirect(
    `/settings/profile?claim_error=${encodeURIComponent(result.reason)}#fediverse`,
    302,
  );
});

/** claim: 紐付け解除 */
profile.post('/profile/claim-unlink', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const form = await c.req.parseBody();
  const remoteActorId = str(form.remote_actor_id);
  if (remoteActorId) await unlinkRemoteAlias(db, remoteActorId, actorId);
  return c.redirect('/settings/profile#fediverse', 302);
});

profile.post('/profile/avatar', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const env = await getEnv();
  const db = createDb(env.DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const { enabled, maxBytes } = getUploadConfig(env);
  const storage = getStorage(env);
  if (!enabled || !storage) {
    return c.redirect('/settings/profile?error=uploads_disabled', 302);
  }

  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File) || file.size === 0) {
    return c.redirect('/settings/profile?error=no_file', 302);
  }
  if (file.size > maxBytes) {
    return c.redirect('/settings/profile?error=too_large', 302);
  }
  const ext = IMAGE_TYPES[file.type];
  if (!ext) {
    return c.redirect('/settings/profile?error=bad_type', 302);
  }

  const key = `avatars/${actorId}/${ulid()}.${ext}`;
  await storage.put(key, await file.arrayBuffer(), file.type);

  const me = await db.query.actors.findFirst({ where: eq(schema.actors.id, actorId) });
  if (me?.avatarUrl?.startsWith('/files/')) {
    await storage.delete(me.avatarUrl.replace(/^\/files\//, '')).catch(() => undefined);
  }

  await db
    .update(schema.actors)
    .set({ avatarUrl: `/files/${key}`, updatedAt: new Date() })
    .where(eq(schema.actors.id, actorId));

  return c.redirect('/settings/profile', 302);
});

/** アクセストークン(PAT)の発行。平文は一度きり表示する */
profile.post('/profile/tokens', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const form = await c.req.parseBody();
  const name = str(form.name) || 'アクセストークン';
  const { token } = await createAccessToken(db, actorId, name.slice(0, 60));

  // 平文はこの画面でのみ表示する(URL・DB には残さない)
  const t = escapeHtml(token);
  const n = escapeHtml(name.slice(0, 60));
  return c.html(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>アクセストークンを発行しました - Yorox</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,'Hiragino Sans',sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.25rem;line-height:1.7;background:#f4f0e4;color:#23283a}
@media(prefers-color-scheme:dark){body{background:#1b2240;color:#f4efde}}
h1{font-size:1.5rem}
.token{font-family:ui-monospace,monospace;font-size:1rem;word-break:break-all;border:2px solid #35507e;background:rgba(53,80,126,.08);padding:.9rem 1rem;border-radius:4px;margin:1rem 0}
.warn{border-left:4px solid #e8446b;padding:.5rem .9rem;background:rgba(232,68,107,.08)}
a{color:#35507e}
</style></head><body>
<h1>アクセストークンを発行しました</h1>
<p>名前: <strong>${n}</strong></p>
<p class="warn">このトークンは <strong>いま一度だけ</strong> 表示されます。安全な場所にコピーして保管してください。二度と表示できません(紛失時は再発行してください)。</p>
<div class="token">${t}</div>
<p>MCP クライアントには <code>Authorization: Bearer ${t}</code> として設定します。エンドポイントは <code>/mcp</code> です。</p>
<p><a href="/settings/profile#tokens">← 設定に戻る</a></p>
</body></html>`,
  );
});

/** アクセストークンの失効 */
profile.post('/profile/tokens/:id/revoke', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  await revokeAccessToken(db, actorId, c.req.param('id'));
  return c.redirect('/settings/profile#tokens', 302);
});

export default function profileRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', profile);
  return (_c, next) => next();
}
