/**
 * ActivityPub 関連の HTTP エンドポイント。
 * Waku の Cloudflare アダプタに middlewareFn として渡し、
 * ページルーティングより先に Hono アプリへ登録する。
 *
 * MVP では連合は行わない(docs/DECISIONS.md)が、
 * 連合前提の ID/URL 設計(docs/URL-DESIGN.md)はここで確立しておく。
 */
import {
  acceptsActivityPub,
  activities,
  AP_MEDIA_TYPE,
  buildEmptyOutbox,
  buildEventObject,
  buildGroupActor,
  buildOrderedCollection,
  JRD_MEDIA_TYPE,
  parseAcct,
  parseSignatureHeader,
  verifyRequest,
  type ApActivity,
} from '@yorox/ap';
import { count, eq, and, isNull } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb, schema } from '../db/client';
import { ensureActorKeys } from '../lib/actor-keys';
import { deliverActivity } from '../lib/deliver';
import { renderMarkdownToHtml } from '../lib/markdown';
import { resolveRemoteActorByKeyId } from '../lib/remote-actor';
import { ulid } from '../lib/ulid';

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
 * 未実装の inbox。URL 予約のみ行い 501 を返す。
 */
const notFederatedYet = (c: Context) =>
  c.text('Federation is not enabled on this instance yet', 501);

ap.post('/inbox', notFederatedYet);
ap.post('/users/:id/inbox', notFederatedYet);
ap.post('/events/:id/inbox', notFederatedYet);

/** Date ヘッダの許容時刻ずれ(リプレイ攻撃の緩和) */
const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000;

/**
 * 受信リクエストの HTTP Signature を検証し、署名者のアクター行を返す。
 * 鍵ローテーション追従のため、検証失敗時は一度だけ再フェッチして再試行する。
 */
async function verifyInboxRequest(c: Context, body: string) {
  const signatureHeader = c.req.header('signature');
  if (!signatureHeader) return null;
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return null;

  const dateHeader = c.req.header('date');
  if (dateHeader) {
    const skew = Math.abs(Date.now() - new Date(dateHeader).getTime());
    if (!Number.isFinite(skew) || skew > MAX_CLOCK_SKEW_MS) return null;
  }

  // 署名対象ヘッダを実リクエストから集める
  const headers: Record<string, string> = {};
  for (const name of parsed.headers) {
    if (name === '(request-target)') continue;
    const value = c.req.header(name);
    if (value === undefined) return null;
    headers[name] = value;
  }
  const path = new URL(c.req.url).pathname;

  const db = createDb((await getEnv()).DB);
  for (const forceRefresh of [false, true]) {
    const signer = await resolveRemoteActorByKeyId(db, parsed.keyId, { forceRefresh });
    if (!signer?.publicKeyPem) {
      console.warn('inbox: signer resolution failed', parsed.keyId);
      return null;
    }
    const ok = await verifyRequest({
      method: c.req.method,
      path,
      headers,
      body,
      parsed,
      publicKeyPem: signer.publicKeyPem,
    });
    if (ok) return signer;
  }
  console.warn('inbox: signature verification failed', parsed.keyId);
  return null;
}

/**
 * グループの inbox。Follow / Undo(Follow) を処理する。
 * それ以外のアクティビティは受領のみ(202)。
 */
ap.post('/groups/:id/inbox', async (c, next) => {
  if (!ULID_RE.test(c.req.param('id'))) return next();
  const db = createDb((await getEnv()).DB);
  const group = await db.query.actors.findFirst({
    where: eq(schema.actors.id, c.req.param('id')),
  });
  if (!group || group.kind !== 'group' || group.state !== 'local') return c.notFound();

  const body = await c.req.text();
  let activity: ApActivity;
  try {
    activity = JSON.parse(body) as ApActivity;
  } catch {
    return c.text('invalid json', 400);
  }
  if (!activity?.type || typeof activity.actor !== 'string') {
    return c.text('invalid activity', 400);
  }

  const signer = await verifyInboxRequest(c, body);
  if (!signer) return c.text('signature verification failed', 401);
  // なりすまし防止: アクティビティの actor と署名者が一致すること
  if (activity.actor !== signer.uri) return c.text('actor mismatch', 401);

  if (activity.type === 'Follow') {
    const objectUri = typeof activity.object === 'string' ? activity.object : undefined;
    if (objectUri !== group.uri) return c.text('object mismatch', 400);

    await db
      .insert(schema.follows)
      .values({
        id: ulid(),
        followerActorId: signer.id,
        followedActorId: group.id,
        activityUri: typeof activity.id === 'string' ? activity.id : null,
        createdAt: new Date(),
      })
      .onConflictDoNothing();

    // Accept(Follow) を署名付きで返送(応答をブロックしない)
    const inboxUrl = signer.sharedInboxUrl ?? signer.inboxUrl;
    if (inboxUrl) {
      const keys = await ensureActorKeys(db, group.id);
      const accept = activities.accept(group.uri, activity, {
        id: `${group.uri}#accepts/follows/${ulid()}`,
        to: signer.uri,
      });
      c.executionCtx.waitUntil(
        deliverActivity({
          activity: accept,
          inboxUrl,
          actorUri: group.uri,
          privateKeyPem: keys.privateKeyPem,
        }).then((ok) => {
          if (!ok) console.warn('inbox: Accept delivery failed', inboxUrl);
        }),
      );
    }
    return c.body(null, 202);
  }

  if (activity.type === 'Undo') {
    const object = activity.object;
    const isUndoFollow =
      typeof object === 'object' &&
      object !== null &&
      !Array.isArray(object) &&
      object.type === 'Follow';
    if (isUndoFollow) {
      await db
        .delete(schema.follows)
        .where(
          and(
            eq(schema.follows.followerActorId, signer.id),
            eq(schema.follows.followedActorId, group.id),
          ),
        );
    }
    return c.body(null, 202);
  }

  // 未対応のアクティビティは受領のみ
  return c.body(null, 202);
});

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
  const origin = new URL(c.req.url).origin;
  if (acceptsActivityPub(c.req.header('accept'))) {
    const db = createDb((await getEnv()).DB);
    const event = await db.query.events.findFirst({
      where: eq(schema.events.id, c.req.param('id')),
    });
    if (!event || event.visibility !== 'public') return c.notFound();
    const group = await db.query.actors.findFirst({
      where: eq(schema.actors.id, event.groupActorId),
    });
    if (!group) return c.notFound();
    const doc = buildEventObject({
      uri: `${origin}/events/${event.id}`,
      name: event.title,
      attributedTo: group.uri,
      contentHtml: event.descriptionMd
        ? renderMarkdownToHtml(event.descriptionMd)
        : undefined,
      startTime: event.startsAt.toISOString(),
      endTime: event.endsAt?.toISOString(),
      locationName: event.venueName ?? undefined,
      locationAddress: event.venueAddress ?? undefined,
      latitude: event.venueLat ?? undefined,
      longitude: event.venueLng ?? undefined,
      url: group.handle
        ? `${origin}/g/${group.handle}/events/${event.id}`
        : undefined,
      imageUrl: event.thumbnailUrl
        ? event.thumbnailUrl.startsWith('/')
          ? `${origin}${event.thumbnailUrl}`
          : event.thumbnailUrl
        : undefined,
      published: event.publishedAt?.toISOString(),
    });
    return c.body(JSON.stringify(doc), 200, { 'content-type': AP_MEDIA_TYPE });
  }
  const url = await findEventHumanUrl(origin, c.req.param('id'));
  if (!url) return c.notFound();
  return c.redirect(url, 302);
});

/** 正規 AP URI /groups/{ulid} も同様に人間向け URL へ */
ap.get('/groups/:id', async (c, next) => {
  if (!ULID_RE.test(c.req.param('id'))) return next();
  const db = createDb((await getEnv()).DB);
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, c.req.param('id')),
  });
  if (!actor?.handle || actor.kind !== 'group') return c.notFound();
  const origin = new URL(c.req.url).origin;
  if (acceptsActivityPub(c.req.header('accept'))) {
    const { publicKeyPem } = await ensureActorKeys(db, actor.id);
    const doc = buildGroupActor({
      uri: actor.uri,
      handle: actor.handle,
      name: actor.displayName,
      summary: actor.summary ?? undefined,
      iconUrl: actor.avatarUrl
        ? actor.avatarUrl.startsWith('/')
          ? `${origin}${actor.avatarUrl}`
          : actor.avatarUrl
        : undefined,
      url: `${origin}/g/${actor.handle}`,
      publicKeyPem,
      published: actor.createdAt.toISOString(),
    });
    return c.body(JSON.stringify(doc), 200, { 'content-type': AP_MEDIA_TYPE });
  }
  return c.redirect(`${origin}/g/${actor.handle}`, 302);
});

/** グループのフォロワーコレクション(件数のみ公開) */
ap.get('/groups/:id/followers', async (c, next) => {
  if (!ULID_RE.test(c.req.param('id'))) return next();
  const db = createDb((await getEnv()).DB);
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, c.req.param('id')),
  });
  if (!actor || actor.kind !== 'group') return c.notFound();
  const [row] = await db
    .select({ n: count() })
    .from(schema.follows)
    .where(eq(schema.follows.followedActorId, actor.id));
  return c.body(
    JSON.stringify(buildOrderedCollection(`${actor.uri}/followers`, row?.n ?? 0)),
    200,
    { 'content-type': AP_MEDIA_TYPE },
  );
});

/** グループの outbox(配信実装までは空コレクション) */
ap.get('/groups/:id/outbox', async (c, next) => {
  if (!ULID_RE.test(c.req.param('id'))) return next();
  const db = createDb((await getEnv()).DB);
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, c.req.param('id')),
  });
  if (!actor || actor.kind !== 'group') return c.notFound();
  return c.body(JSON.stringify(buildEmptyOutbox(`${actor.uri}/outbox`)), 200, {
    'content-type': AP_MEDIA_TYPE,
  });
});

/**
 * middlewareFn 本体: AP ルートを Hono アプリへマウントする。
 */
export default function apRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', ap);
  return (_c, next) => next();
}
