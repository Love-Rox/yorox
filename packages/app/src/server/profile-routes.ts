/**
 * プロフィール編集(本人)とプロフィール URL のエンドポイント。
 */
import { and, eq, isNull } from 'drizzle-orm';
import { generateToken } from '../lib/token';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb, schema } from '../db/client';
import { ulid } from '../lib/ulid';
import { getStorage, getUploadConfig, IMAGE_TYPES } from '../storage/driver';
import { claimBluesky, claimByRelMe, generateClaimCode, unlinkRemoteAlias } from './claim';
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

/** お知らせ受け取り設定 */
profile.post('/profile/notifications', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const form = await c.req.parseBody();
  await db
    .update(schema.users)
    .set({ emailNotifications: form.email_notifications !== undefined })
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

export default function profileRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', profile);
  return (_c, next) => next();
}
