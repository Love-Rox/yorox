/**
 * ActivityPub 関連の HTTP エンドポイント。
 * Waku の Cloudflare アダプタに middlewareFn として渡し、
 * ページルーティングより先に Hono アプリへ登録する。
 *
 * MVP では連合は行わない(docs/DECISIONS.md)が、
 * 連合前提の ID/URL 設計(docs/URL-DESIGN.md)はここで確立しておく。
 */
import { acceptsActivityPub, JRD_MEDIA_TYPE, parseAcct } from '@yorox/ap';
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

/** ULID(26文字 Crockford Base32)かどうか。正規 URI ルートの誤マッチ防止 */
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

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
    software: { name: 'yorox', version: __YOROX_VERSION__ },
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

/** イベントの人間向け URL を引く(短縮 URL・正規 URI からのリダイレクト用) */
async function findEventHumanUrl(origin: string, eventId: string): Promise<string | null> {
  const db = createDb((await getEnv()).DB);
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
  });
  if (!event) return null;
  const group = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  if (!group?.handle) return null;
  return `${origin}/g/${group.handle}/events/${event.id}`;
}

/** 短縮 URL: /e/{ulid} → 正規の人間向け URL */
ap.get('/e/:id', async (c, next) => {
  if (!ULID_RE.test(c.req.param('id'))) return next();
  const url = await findEventHumanUrl(new URL(c.req.url).origin, c.req.param('id'));
  if (!url) return c.notFound();
  return c.redirect(url, 302);
});

/**
 * 正規 AP URI /events/{ulid} への HTML アクセスは人間向け URL へ 302。
 * AP メディアタイプ要求は連合実装まで 406(URL は不変で予約済み)。
 */
ap.get('/events/:id', async (c, next) => {
  if (!ULID_RE.test(c.req.param('id'))) return next();
  if (acceptsActivityPub(c.req.header('accept'))) {
    return c.text('ActivityPub representation is not available yet', 406);
  }
  const url = await findEventHumanUrl(new URL(c.req.url).origin, c.req.param('id'));
  if (!url) return c.notFound();
  return c.redirect(url, 302);
});

/** 正規 AP URI /groups/{ulid} も同様に人間向け URL へ */
ap.get('/groups/:id', async (c, next) => {
  if (!ULID_RE.test(c.req.param('id'))) return next();
  if (acceptsActivityPub(c.req.header('accept'))) {
    return c.text('ActivityPub representation is not available yet', 406);
  }
  const db = createDb((await getEnv()).DB);
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, c.req.param('id')),
  });
  if (!actor?.handle || actor.kind !== 'group') return c.notFound();
  return c.redirect(`${new URL(c.req.url).origin}/g/${actor.handle}`, 302);
});

/**
 * middlewareFn 本体: AP ルートを Hono アプリへマウントする。
 */
export default function apRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', ap);
  return (_c, next) => next();
}
