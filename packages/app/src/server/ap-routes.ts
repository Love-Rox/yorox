/**
 * ActivityPub 関連の HTTP エンドポイント。
 * Waku の Cloudflare アダプタに middlewareFn として渡し、
 * ページルーティングより先に Hono アプリへ登録する。
 *
 * MVP では連合は行わない(docs/DECISIONS.md)が、
 * 連合前提の ID/URL 設計(docs/URL-DESIGN.md)はここで確立しておく。
 */
import { JRD_MEDIA_TYPE, parseAcct } from '@yorox/ap';
import { eq, and, isNull } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb, schema } from '../db/client';

async function getEnv(): Promise<Env> {
  // cloudflare:workers はビルド時に workerd ランタイムでのみ解決される
  const { env } = await import('cloudflare:workers');
  return env;
}

const ap = new Hono();

/**
 * WebFinger: acct:handle@host → ローカルアクターの AP URI を返す。
 * ハンドルはユーザー/グループ単一名前空間。当面 AP 露出はグループのみだが、
 * webfinger 解決自体は kind を問わず行う(露出制御はアクター文書側で行う)。
 */
ap.get('/.well-known/webfinger', async (c) => {
  const resource = c.req.query('resource');
  if (!resource) return c.text('resource is required', 400);

  const acct = parseAcct(resource);
  if (!acct) return c.text('unsupported resource', 400);

  const host = new URL(c.req.url).host;
  if (acct.host !== host) return c.notFound();

  const db = createDb((await getEnv()).DB);
  const actor = await db.query.actors.findFirst({
    where: and(
      eq(schema.actors.handle, acct.user),
      isNull(schema.actors.domain),
    ),
  });
  if (!actor) return c.notFound();

  const origin = new URL(c.req.url).origin;
  const profilePath = actor.kind === 'group' ? `/g/${actor.handle}` : `/@${actor.handle}`;
  return c.body(
    JSON.stringify({
      subject: `acct:${acct.user}@${host}`,
      aliases: [actor.uri],
      links: [
        { rel: 'self', type: 'application/activity+json', href: actor.uri },
        {
          rel: 'http://webfinger.net/rel/profile-page',
          type: 'text/html',
          href: `${origin}${profilePath}`,
        },
      ],
    }),
    200,
    { 'content-type': JRD_MEDIA_TYPE },
  );
});

/** NodeInfo ディスカバリ(本文は連合実装時に拡充) */
ap.get('/.well-known/nodeinfo', (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    links: [
      {
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
        href: `${origin}/nodeinfo/2.1`,
      },
    ],
  });
});

ap.get('/nodeinfo/2.1', (c) => {
  return c.json({
    version: '2.1',
    software: { name: 'yorox', version: '0.0.0' },
    protocols: ['activitypub'],
    services: { inbound: [], outbound: [] },
    openRegistrations: false,
    usage: { users: {} },
    metadata: {},
  });
});

/**
 * 共有 inbox / アクター inbox。
 * MVP では連合を受け付けない: URL 予約のみ行い 501 を返す。
 */
const notFederatedYet = (c: Context) =>
  c.text('Federation is not enabled on this instance yet', 501);

ap.post('/inbox', notFederatedYet);
ap.post('/users/:id/inbox', notFederatedYet);
ap.post('/groups/:id/inbox', notFederatedYet);
ap.post('/events/:id/inbox', notFederatedYet);

/**
 * middlewareFn 本体: AP ルートを Hono アプリへマウントする。
 */
export default function apRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', ap);
  return (_c, next) => next();
}
