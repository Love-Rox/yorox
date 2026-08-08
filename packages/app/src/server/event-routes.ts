/**
 * イベント作成・公開・枠追加・申込・キャンセルの HTTP エンドポイント。
 * フォーム POST(SameSite=Lax cookie + Origin 検証)で受ける。
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb, schema } from '../db/client';
import { addSlot, createEvent, publishEvent, updateEvent } from '../domain/event-service';
import {
  AlreadyJoinedError,
  cancelParticipation,
  ConditionNotMetError,
  joinSlot,
  SlotFullError,
} from '../domain/participation';
import type { SlotConditions } from '../db/schema';
import { geocodeAddress } from '../lib/geocode';
import { getSlotCoordinator } from './coordinator';
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

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function optionalInt(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * datetime-local の値をイベントのタイムゾーンとして解釈する。
 * MVP は Asia/Tokyo 固定(+09:00)。他 TZ 対応時はここを差し替える。
 */
function parseLocalDateTime(v: unknown): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(`${s}:00+09:00`);
  return Number.isNaN(t) ? undefined : new Date(t);
}

const events = new Hono();

/** イベント作成(下書き) */
events.post('/g/:handle/events', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);

  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const groupActor = await db.query.actors.findFirst({
    where: and(
      eq(schema.actors.handle, handle),
      isNull(schema.actors.domain),
      eq(schema.actors.kind, 'group'),
    ),
  });
  if (!groupActor) return c.notFound();
  if (!(await hasGroupPermission(db, groupActor.id, actorId, 'event.create'))) {
    return c.text('このグループでイベントを作成する権限がありません', 403);
  }

  const form = await c.req.parseBody();
  const startsAt = parseLocalDateTime(form.starts_at);
  if (!str(form.title) || !startsAt) {
    return c.redirect(`/g/${handle}/events/new?error=invalid_input`, 302);
  }

  try {
    // 住所があれば保存時に一度だけジオコーディングする(地図表示用)
    const venueAddress = str(form.venue_address);
    const geo = venueAddress ? await geocodeAddress(venueAddress) : null;
    const { eventId } = await createEvent(db, {
      groupActorId: groupActor.id,
      title: str(form.title),
      descriptionMd: str(form.description_md) || undefined,
      participantInfoMd: str(form.participant_info_md) || undefined,
      thumbnailUrl: str(form.thumbnail_url) || undefined,
      startsAt,
      endsAt: parseLocalDateTime(form.ends_at),
      venueName: str(form.venue_name) || undefined,
      venueAddress: venueAddress || undefined,
      venueLat: geo?.lat,
      venueLng: geo?.lng,
      onlineUrl: str(form.online_url) || undefined,
      createdByActorId: actorId,
    });
    return c.redirect(`/g/${handle}/events/${eventId}`, 302);
  } catch {
    return c.redirect(`/g/${handle}/events/new?error=invalid_input`, 302);
  }
});

/** ドメイン共通: イベントに対する編集権限チェック */
async function canEditEvent(
  db: ReturnType<typeof createDb>,
  eventId: string,
  actorId: string,
): Promise<{ event: typeof schema.events.$inferSelect; handle: string } | null> {
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
  if (!event) return null;
  const groupActor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  if (!groupActor?.handle) return null;
  const allowed = await hasGroupPermission(db, event.groupActorId, actorId, 'event.edit');
  return allowed ? { event, handle: groupActor.handle } : null;
}

/** 基本情報の更新 */
events.post('/events/:id/update', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await canEditEvent(db, c.req.param('id'), actorId);
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const startsAt = parseLocalDateTime(form.starts_at);
  const editUrl = `/g/${ctx.handle}/events/${ctx.event.id}/edit`;
  if (!str(form.title) || !startsAt) {
    return c.redirect(`${editUrl}?error=invalid_input`, 302);
  }

  try {
    // 住所が変わったときだけ再ジオコーディング(同一なら既存座標を維持)
    const venueAddress = str(form.venue_address);
    const geo =
      venueAddress && venueAddress !== (ctx.event.venueAddress ?? '')
        ? await geocodeAddress(venueAddress)
        : venueAddress
          ? { lat: ctx.event.venueLat ?? undefined, lng: ctx.event.venueLng ?? undefined }
          : null;
    await updateEvent(db, ctx.event.id, {
      title: str(form.title),
      descriptionMd: str(form.description_md) || undefined,
      participantInfoMd: str(form.participant_info_md) || undefined,
      thumbnailUrl: str(form.thumbnail_url) || undefined,
      startsAt,
      endsAt: parseLocalDateTime(form.ends_at),
      venueName: str(form.venue_name) || undefined,
      venueAddress: venueAddress || undefined,
      venueLat: geo?.lat ?? undefined,
      venueLng: geo?.lng ?? undefined,
      onlineUrl: str(form.online_url) || undefined,
      sessionsLabel: str(form.sessions_label) === 'timetable' ? 'timetable' : 'sessions',
    });
    return c.redirect(`/g/${ctx.handle}/events/${ctx.event.id}`, 302);
  } catch {
    return c.redirect(`${editUrl}?error=invalid_input`, 302);
  }
});

/** 公開 */
events.post('/events/:id/publish', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await canEditEvent(db, c.req.param('id'), actorId);
  if (!ctx) return c.text('権限がありません', 403);

  await publishEvent(db, ctx.event.id);
  return c.redirect(`/g/${ctx.handle}/events/${ctx.event.id}`, 302);
});

/** 枠追加(枠ポリシー5要素) */
events.post('/events/:id/slots', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await canEditEvent(db, c.req.param('id'), actorId);
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const eventUrl = `/g/${ctx.handle}/events/${ctx.event.id}`;

  const method = str(form.method) === 'lottery' ? 'lottery' : 'fcfs';
  const conditions: SlotConditions = {};
  if (form.require_claimed === 'on') conditions.requireClaimed = true;
  const minAge = optionalInt(form.min_account_age_days);
  if (minAge !== undefined && minAge > 0) conditions.minAccountAgeDays = minAge;
  const minAttended = optionalInt(form.min_attended_count);
  if (minAttended !== undefined && minAttended > 0) conditions.minAttendedCount = minAttended;

  try {
    await addSlot(db, {
      eventId: ctx.event.id,
      name: str(form.name),
      capacity: optionalInt(form.capacity) ?? 0,
      method,
      waitlistModel: str(form.waitlist_model) === 'separate' ? 'separate' : 'connpass',
      waitlistCapacity: optionalInt(form.waitlist_capacity),
      promotionPolicy:
        str(form.promotion_policy) === 'auto_deadline'
          ? 'auto_deadline'
          : str(form.promotion_policy) === 'consent'
            ? 'consent'
            : 'auto',
      promotionDeadlineHours: optionalInt(form.promotion_deadline_hours),
      lotteryLogic:
        method === 'lottery'
          ? str(form.lottery_logic) === 'manual'
            ? 'manual'
            : str(form.lottery_logic) === 'weighted'
              ? 'weighted'
              : 'random'
          : undefined,
      lotteryAt: method === 'lottery' ? parseLocalDateTime(form.lottery_at) : undefined,
      conditions: Object.keys(conditions).length > 0 ? conditions : undefined,
    });
    return c.redirect(eventUrl, 302);
  } catch {
    return c.redirect(`${eventUrl}?error=slot_invalid`, 302);
  }
});

/** 申込 */
events.post('/slots/:id/join', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const slot = await db.query.slots.findFirst({
    where: eq(schema.slots.id, c.req.param('id')),
  });
  if (!slot) return c.notFound();
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, slot.eventId),
  });
  const groupActor = event
    ? await db.query.actors.findFirst({ where: eq(schema.actors.id, event.groupActorId) })
    : null;
  if (!event || event.visibility !== 'public' || !groupActor?.handle) return c.notFound();

  const eventUrl = `/g/${groupActor.handle}/events/${event.id}`;
  try {
    const slotCoordinator = await getSlotCoordinator();
    await joinSlot(
      db,
      { slotId: slot.id, actorId },
      slotCoordinator ? { slotCoordinator } : {},
    );
    return c.redirect(eventUrl, 302);
  } catch (err) {
    if (err instanceof SlotFullError) return c.redirect(`${eventUrl}?error=full`, 302);
    if (err instanceof AlreadyJoinedError)
      return c.redirect(`${eventUrl}?error=already`, 302);
    if (err instanceof ConditionNotMetError)
      return c.redirect(`${eventUrl}?error=condition&reason=${encodeURIComponent(err.reason)}`, 302);
    throw err;
  }
});

/** キャンセル(本人のみ) */
events.post('/participations/:id/cancel', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const participation = await db.query.participations.findFirst({
    where: eq(schema.participations.id, c.req.param('id')),
  });
  if (!participation || participation.actorId !== actorId) return c.notFound();

  const slot = await db.query.slots.findFirst({
    where: eq(schema.slots.id, participation.slotId),
  });
  const event = slot
    ? await db.query.events.findFirst({ where: eq(schema.events.id, slot.eventId) })
    : null;
  const groupActor = event
    ? await db.query.actors.findFirst({ where: eq(schema.actors.id, event.groupActorId) })
    : null;

  await cancelParticipation(db, participation.id);

  const back =
    event && groupActor?.handle ? `/g/${groupActor.handle}/events/${event.id}` : '/';
  return c.redirect(back, 302);
});

export default function eventRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', events);
  return (_c, next) => next();
}
