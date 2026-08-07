/**
 * RSC から使う読み取りクエリ集。
 * cloudflare:workers の env は workerd ランタイム内でのみ解決される。
 */
import { and, asc, desc, eq, gte, isNull } from 'drizzle-orm';
import { createDb, schema, type Db } from '../db/client';

export async function getDb(): Promise<Db> {
  const { env } = await import('cloudflare:workers');
  return createDb(env.DB);
}

/** 公開済みの今後のイベント一覧(トップページ用) */
export async function listUpcomingEvents(db: Db, limit = 20) {
  return db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      startsAt: schema.events.startsAt,
      venueName: schema.events.venueName,
      onlineUrl: schema.events.onlineUrl,
      groupHandle: schema.actors.handle,
      groupName: schema.actors.displayName,
    })
    .from(schema.events)
    .innerJoin(schema.actors, eq(schema.events.groupActorId, schema.actors.id))
    .where(
      and(eq(schema.events.visibility, 'public'), gte(schema.events.startsAt, new Date())),
    )
    .orderBy(asc(schema.events.startsAt))
    .limit(limit);
}

/** handle からローカルグループを引く */
export async function getGroupByHandle(db: Db, handle: string) {
  const actor = await db.query.actors.findFirst({
    where: and(
      eq(schema.actors.handle, handle),
      isNull(schema.actors.domain),
      eq(schema.actors.kind, 'group'),
    ),
  });
  if (!actor) return null;
  const group = await db.query.groups.findFirst({
    where: eq(schema.groups.actorId, actor.id),
  });
  if (!group) return null;
  return { actor, group };
}

/** グループの公開イベント(新しい順) */
export async function listGroupEvents(db: Db, groupActorId: string, limit = 50) {
  return db.query.events.findMany({
    where: and(
      eq(schema.events.groupActorId, groupActorId),
      eq(schema.events.visibility, 'public'),
    ),
    orderBy: [desc(schema.events.startsAt)],
    limit,
  });
}

/** イベント詳細(枠・セッション・資料・参加者数まで) */
export async function getEventDetail(db: Db, eventId: string) {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
  });
  if (!event) return null;

  const groupActor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });

  const slots = await db.query.slots.findMany({
    where: eq(schema.slots.eventId, eventId),
    orderBy: [asc(schema.slots.sortOrder)],
  });

  const slotStats = new Map<string, { accepted: number; waitlisted: number }>();
  for (const slot of slots) {
    const rows = await db.query.participations.findMany({
      where: eq(schema.participations.slotId, slot.id),
    });
    slotStats.set(slot.id, {
      accepted: rows.filter((r) => r.status === 'accepted').length,
      waitlisted: rows.filter((r) => r.status === 'waitlisted' || r.status === 'consent_pending')
        .length,
    });
  }

  const sessions = await db.query.eventSessions.findMany({
    where: eq(schema.eventSessions.eventId, eventId),
    orderBy: [asc(schema.eventSessions.sortOrder)],
  });

  const materials = await db.query.materials.findMany({
    where: eq(schema.materials.eventId, eventId),
  });

  return { event, groupActor, slots, slotStats, sessions, materials };
}
