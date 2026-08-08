/**
 * イベントの作成・公開・枠追加のドメインサービス。
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import type { SlotConditions } from '../db/schema';
import { ulid } from '../lib/ulid';
import { emitDomainEvent } from './events';

export interface CreateEventInput {
  groupActorId: string;
  title: string;
  descriptionMd?: string | undefined;
  participantInfoMd?: string | undefined;
  startsAt: Date;
  endsAt?: Date | undefined;
  timezone?: string | undefined;
  venueName?: string | undefined;
  venueAddress?: string | undefined;
  venueLat?: number | undefined;
  venueLng?: number | undefined;
  onlineUrl?: string | undefined;
  createdByActorId: string;
}

/** 下書き状態でイベントを作成する */
export async function createEvent(
  db: Db,
  input: CreateEventInput,
  now: Date = new Date(),
): Promise<{ eventId: string }> {
  if (!input.title.trim()) throw new Error('タイトルは必須です');
  const eventId = ulid();
  await db.insert(schema.events).values({
    id: eventId,
    groupActorId: input.groupActorId,
    title: input.title.trim(),
    descriptionMd: input.descriptionMd ?? null,
    participantInfoMd: input.participantInfoMd ?? null,
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    timezone: input.timezone ?? 'Asia/Tokyo',
    venueName: input.venueName ?? null,
    venueAddress: input.venueAddress ?? null,
    venueLat: input.venueLat ?? null,
    venueLng: input.venueLng ?? null,
    onlineUrl: input.onlineUrl ?? null,
    visibility: 'draft',
    createdByActorId: input.createdByActorId,
    createdAt: now,
    updatedAt: now,
  });
  return { eventId };
}

export interface UpdateEventInput {
  title: string;
  descriptionMd?: string | undefined;
  participantInfoMd?: string | undefined;
  startsAt: Date;
  endsAt?: Date | undefined;
  venueName?: string | undefined;
  venueAddress?: string | undefined;
  venueLat?: number | undefined;
  venueLng?: number | undefined;
  onlineUrl?: string | undefined;
  sessionsLabel?: 'sessions' | 'timetable' | undefined;
}

/** イベントの基本情報を更新する */
export async function updateEvent(
  db: Db,
  eventId: string,
  input: UpdateEventInput,
  now: Date = new Date(),
): Promise<void> {
  if (!input.title.trim()) throw new Error('タイトルは必須です');
  await db
    .update(schema.events)
    .set({
      title: input.title.trim(),
      descriptionMd: input.descriptionMd ?? null,
      participantInfoMd: input.participantInfoMd ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      venueName: input.venueName ?? null,
      venueAddress: input.venueAddress ?? null,
      venueLat: input.venueLat ?? null,
      venueLng: input.venueLng ?? null,
      onlineUrl: input.onlineUrl ?? null,
      sessionsLabel: input.sessionsLabel ?? 'sessions',
      updatedAt: now,
    })
    .where(eq(schema.events.id, eventId));
}

/** 下書きイベントを公開する */
export async function publishEvent(
  db: Db,
  eventId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(schema.events)
    .set({ visibility: 'public', publishedAt: now, updatedAt: now })
    .where(eq(schema.events.id, eventId));
  await emitDomainEvent(db, 'event.published', { eventId }, now);
}

export interface AddSlotInput {
  eventId: string;
  name: string;
  capacity: number;
  method: 'fcfs' | 'lottery';
  waitlistModel: 'connpass' | 'separate';
  waitlistCapacity?: number | undefined;
  promotionPolicy: 'auto' | 'auto_deadline' | 'consent';
  promotionDeadlineHours?: number | undefined;
  lotteryLogic?: 'random' | 'manual' | 'weighted' | undefined;
  lotteryAt?: Date | undefined;
  conditions?: SlotConditions | undefined;
}

/** 参加枠を追加する(枠ポリシー5要素はすべて呼び出し側で選択済み) */
export async function addSlot(
  db: Db,
  input: AddSlotInput,
  now: Date = new Date(),
): Promise<{ slotId: string }> {
  if (!input.name.trim()) throw new Error('枠名は必須です');
  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    throw new Error('定員は1以上の整数が必要です');
  }
  if (input.method === 'lottery' && !input.lotteryLogic) {
    throw new Error('抽選枠には抽選ロジックの指定が必要です');
  }

  const existing = await db.query.slots.findMany({
    where: eq(schema.slots.eventId, input.eventId),
  });

  const slotId = ulid();
  await db.insert(schema.slots).values({
    id: slotId,
    eventId: input.eventId,
    name: input.name.trim(),
    capacity: input.capacity,
    method: input.method,
    waitlistModel: input.waitlistModel,
    waitlistCapacity: input.waitlistCapacity ?? null,
    promotionPolicy: input.promotionPolicy,
    promotionDeadlineHours: input.promotionDeadlineHours ?? null,
    lotteryLogic: input.method === 'lottery' ? (input.lotteryLogic ?? 'random') : null,
    lotteryAt: input.lotteryAt ?? null,
    conditions: input.conditions ?? null,
    sortOrder: existing.length,
    createdAt: now,
  });
  return { slotId };
}
