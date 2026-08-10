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
import { isDiscordWebhookUrl } from '../lib/discord';
import { buildActorOgSvg } from '../lib/ogp';
import { ulid } from '../lib/ulid';
import { renderOgPngResponse } from './og';
import { clearSessionCookieHeader } from '../auth/session';
import { getStorage, getUploadConfig, IMAGE_TYPES } from '../storage/driver';
import { claimBluesky, claimByRelMe, generateClaimCode, unlinkRemoteAlias } from './claim';
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

/** お知らせ受け取り設定 */
profile.post('/profile/notifications', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const form = await c.req.parseBody();
  // Discord Webhook は形式が正しいときだけ保存(SSRF 対策)
  const webhook = str(form.discord_webhook_url);
  await db
    .update(schema.users)
    .set({
      emailNotifications: form.email_notifications !== undefined,
      discordDmNotifications: form.discord_dm_notifications !== undefined,
      discordWebhookUrl: webhook && isDiscordWebhookUrl(webhook) ? webhook : null,
    })
    .where(eq(schema.users.actorId, actorId));
  return c.redirect('/settings/profile?notify_saved=1#notifications', 302);
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
