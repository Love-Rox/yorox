/**
 * ファイル配信とアップロードのエンドポイント(docs/DECISIONS.md「コンテンツ」)。
 * - GET /files/* : R2 から配信(キーは ULID 入りで不変 → 長期キャッシュ)
 * - POST /events/:id/thumbnail : サムネイル画像のアップロード(event.edit 権限)
 */
import { eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb, schema } from '../db/client';
import { ulid } from '../lib/ulid';
import { getStorage, getUploadConfig, IMAGE_TYPES } from '../storage/driver';
import { getSessionActorId, hasGroupPermission } from './route-auth';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

function assertSameOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  return origin === new URL(c.req.url).origin;
}

const files = new Hono();

/** R2 からの配信。キーは再利用しないため immutable キャッシュでよい */
files.get('/files/*', async (c) => {
  const env = await getEnv();
  const storage = getStorage(env);
  if (!storage) return c.notFound();

  const key = c.req.path.replace(/^\/files\//, '');
  if (!key || key.includes('..')) return c.notFound();

  const file = await storage.get(key);
  if (!file) return c.notFound();

  return c.body(file.body, 200, {
    'content-type': file.contentType,
    'content-length': String(file.size),
    'cache-control': 'public, max-age=31536000, immutable',
  });
});

/** イベントサムネイルのアップロード */
files.post('/events/:id/thumbnail', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const env = await getEnv();
  const db = createDb(env.DB);

  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, c.req.param('id')),
  });
  if (!event) return c.notFound();
  const groupActor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  if (!groupActor?.handle) return c.notFound();
  if (!(await hasGroupPermission(db, event.groupActorId, actorId, 'event.edit'))) {
    return c.text('権限がありません', 403);
  }

  const editUrl = `/g/${groupActor.handle}/events/${event.id}/edit`;
  const { enabled, maxBytes } = getUploadConfig(env);
  const storage = getStorage(env);
  if (!enabled || !storage) {
    return c.redirect(`${editUrl}?error=uploads_disabled`, 302);
  }

  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File) || file.size === 0) {
    return c.redirect(`${editUrl}?error=no_file`, 302);
  }
  if (file.size > maxBytes) {
    return c.redirect(`${editUrl}?error=too_large`, 302);
  }
  const ext = IMAGE_TYPES[file.type];
  if (!ext) {
    return c.redirect(`${editUrl}?error=bad_type`, 302);
  }

  const key = `thumbnails/${event.id}/${ulid()}.${ext}`;
  await storage.put(key, await file.arrayBuffer(), file.type);

  // 旧サムネイルが自ホスティングなら削除しておく(ストレージを汚さない)
  const prev = event.thumbnailUrl;
  if (prev?.startsWith('/files/')) {
    await storage.delete(prev.replace(/^\/files\//, '')).catch(() => undefined);
  }

  await db
    .update(schema.events)
    .set({ thumbnailUrl: `/files/${key}`, updatedAt: new Date() })
    .where(eq(schema.events.id, event.id));

  return c.redirect(`/g/${groupActor.handle}/events/${event.id}`, 302);
});

export default function fileRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', files);
  return (_c, next) => next();
}
