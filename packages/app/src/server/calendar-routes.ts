/**
 * カレンダー(iCalendar / ics)エンドポイント。
 * - /events/:id.ics       … 公開イベント1件のダウンロード
 * - /calendar/:token.ics  … ユーザーの参加確定イベントの購読フィード
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb, schema } from '../db/client';
import { buildIcs, type IcsEvent } from '../lib/ics';
import { requestOrigin } from './http';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

type EventRow = typeof schema.events.$inferSelect;

/** イベント → IcsEvent(会場 or オンライン、説明にリンク) */
function toIcsEvent(event: EventRow, origin: string, groupHandle: string | null): IcsEvent {
  const humanUrl = groupHandle
    ? `${origin}/g/${groupHandle}/events/${event.id}`
    : `${origin}/events/${event.id}`;
  const location = event.venueName
    ? event.venueAddress
      ? `${event.venueName}(${event.venueAddress})`
      : event.venueName
    : event.onlineUrl
      ? 'オンライン'
      : null;
  return {
    uid: `event-${event.id}@${new URL(origin).host}`,
    title: event.title,
    start: event.startsAt,
    end: event.endsAt,
    location,
    description: humanUrl,
    url: humanUrl,
    updated: event.updatedAt,
  };
}

function icsResponse(c: Context, body: string, filename: string) {
  return c.body(body, 200, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'private, max-age=300',
  });
}

const cal = new Hono();

/** 公開イベント1件の ics */
cal.get('/events/:id/calendar.ics', async (c) => {
  const id = c.req.param('id');
  if (!ULID_RE.test(id)) return c.notFound();
  const db = createDb((await getEnv()).DB);
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, id) });
  if (!event || event.visibility !== 'public') return c.notFound();
  const group = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  const origin = await requestOrigin(c);
  const ics = buildIcs(
    [toIcsEvent(event, origin, group?.handle ?? null)],
    event.title,
    new Date(),
  );
  return icsResponse(c, ics, `${id}.ics`);
});

/** ユーザーの参加確定イベント購読フィード(秘密トークン URL) */
cal.get('/calendar/:token/yorox.ics', async (c) => {
  const token = c.req.param('token');
  if (!token) return c.notFound();
  const db = createDb((await getEnv()).DB);
  const account = await db.query.users.findFirst({
    where: eq(schema.users.calendarToken, token),
  });
  if (!account) return c.notFound();

  // 本人+連携済みエイリアスの参加確定・支払い待ち(席を持つ状態)を対象に
  const aliases = await db.query.actors.findMany({
    where: eq(schema.actors.claimedByActorId, account.actorId),
  });
  const identityIds = [account.actorId, ...aliases.map((a) => a.id)];

  const rows = await db
    .select({ event: schema.events, groupHandle: schema.actors.handle })
    .from(schema.participations)
    .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
    .innerJoin(schema.events, eq(schema.slots.eventId, schema.events.id))
    .innerJoin(schema.actors, eq(schema.events.groupActorId, schema.actors.id))
    .where(
      and(
        inArray(schema.participations.actorId, identityIds),
        inArray(schema.participations.status, ['accepted', 'payment_pending']),
        eq(schema.events.visibility, 'public'),
      ),
    );

  // 同一イベントの重複(複数枠)を除く
  const origin = await requestOrigin(c);
  const seen = new Set<string>();
  const items: IcsEvent[] = [];
  for (const r of rows) {
    if (seen.has(r.event.id)) continue;
    seen.add(r.event.id);
    items.push(toIcsEvent(r.event, origin, r.groupHandle));
  }
  const ics = buildIcs(items, 'Yorox 参加予定', new Date());
  return icsResponse(c, ics, 'yorox-calendar.ics');
});

export default function calendarRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', cal);
  return (_c, next) => next();
}
