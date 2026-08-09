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
  thumbnailUrl?: string | undefined;
  startsAt: Date;
  endsAt?: Date | undefined;
  timezone?: string | undefined;
  venueName?: string | undefined;
  venueAddress?: string | undefined;
  venueLat?: number | undefined;
  venueLng?: number | undefined;
  onlineUrl?: string | undefined;
  remoteJoinMethods?: ('reply' | 'join')[] | undefined;
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
    thumbnailUrl: input.thumbnailUrl ?? null,
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    timezone: input.timezone ?? 'Asia/Tokyo',
    venueName: input.venueName ?? null,
    venueAddress: input.venueAddress ?? null,
    venueLat: input.venueLat ?? null,
    venueLng: input.venueLng ?? null,
    onlineUrl: input.onlineUrl ?? null,
    remoteJoinMethods: input.remoteJoinMethods ?? ['reply', 'join'],
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
  thumbnailUrl?: string | undefined;
  startsAt: Date;
  endsAt?: Date | undefined;
  venueName?: string | undefined;
  venueAddress?: string | undefined;
  venueLat?: number | undefined;
  venueLng?: number | undefined;
  onlineUrl?: string | undefined;
  sessionsLabel?: 'sessions' | 'timetable' | undefined;
  remoteJoinMethods?: ('reply' | 'join')[] | undefined;
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
      thumbnailUrl: input.thumbnailUrl ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      venueName: input.venueName ?? null,
      venueAddress: input.venueAddress ?? null,
      venueLat: input.venueLat ?? null,
      venueLng: input.venueLng ?? null,
      onlineUrl: input.onlineUrl ?? null,
      sessionsLabel: input.sessionsLabel ?? 'sessions',
      remoteJoinMethods: input.remoteJoinMethods ?? ['reply', 'join'],
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
    .set({ visibility: 'public', publishedAt: now, publishAt: null, updatedAt: now })
    .where(eq(schema.events.id, eventId));
  await emitDomainEvent(db, 'event.published', { eventId }, now);
}

/**
 * イベントを下書きとして複製する(定例イベント向け)。
 * 基本情報・枠・セッション・資料リンクをコピーし、公開状態やトークン、
 * 抽選/リマインダーの時刻など「その回限り」の状態はリセットする。
 * 参加者・出欠・支払いはコピーしない。
 */
export async function duplicateEvent(
  db: Db,
  sourceEventId: string,
  createdByActorId: string,
  now: Date = new Date(),
): Promise<{ eventId: string }> {
  const src = await db.query.events.findFirst({
    where: eq(schema.events.id, sourceEventId),
  });
  if (!src) throw new Error('複製元のイベントが見つかりません');

  const newEventId = ulid();
  await db.insert(schema.events).values({
    id: newEventId,
    groupActorId: src.groupActorId,
    title: `${src.title}(コピー)`,
    descriptionMd: src.descriptionMd,
    participantInfoMd: src.participantInfoMd,
    thumbnailUrl: src.thumbnailUrl,
    startsAt: src.startsAt,
    endsAt: src.endsAt,
    timezone: src.timezone,
    venueName: src.venueName,
    venueAddress: src.venueAddress,
    venueLat: src.venueLat,
    venueLng: src.venueLng,
    onlineUrl: src.onlineUrl,
    sessionsLabel: src.sessionsLabel,
    remoteJoinMethods: src.remoteJoinMethods,
    // 「その回限り」の状態はリセット
    visibility: 'draft',
    participantListPublic: src.participantListPublic,
    checkinToken: null,
    publishedAt: null,
    publishAt: null,
    reminderSentAt: null,
    createdByActorId,
    createdAt: now,
    updatedAt: now,
  });

  // 枠をコピー(抽選予定時刻は過去のまま持ち越すと cron が即発火するため null)
  const slots = await db.query.slots.findMany({
    where: eq(schema.slots.eventId, sourceEventId),
  });
  for (const s of slots) {
    await db.insert(schema.slots).values({
      id: ulid(),
      eventId: newEventId,
      name: s.name,
      capacity: s.capacity,
      method: s.method,
      waitlistModel: s.waitlistModel,
      waitlistCapacity: s.waitlistCapacity,
      promotionPolicy: s.promotionPolicy,
      promotionDeadlineHours: s.promotionDeadlineHours,
      lotteryLogic: s.lotteryLogic,
      lotteryAt: null,
      conditions: s.conditions,
      allowRemote: s.allowRemote,
      isSpeakerSlot: s.isSpeakerSlot,
      price: s.price,
      currency: s.currency,
      paymentMethod: s.paymentMethod,
      paymentUrl: s.paymentUrl,
      paymentConfirm: s.paymentConfirm,
      sortOrder: s.sortOrder,
      createdAt: now,
    });
  }

  // セッション(登壇枠情報)をコピー。個別の開始/終了時刻は持ち越さない
  const sessions = await db.query.eventSessions.findMany({
    where: eq(schema.eventSessions.eventId, sourceEventId),
  });
  for (const sess of sessions) {
    await db.insert(schema.eventSessions).values({
      id: ulid(),
      eventId: newEventId,
      title: sess.title,
      descriptionMd: sess.descriptionMd,
      speakerActorId: sess.speakerActorId,
      speakerName: sess.speakerName,
      speakerUrl: sess.speakerUrl,
      startsAt: null,
      endsAt: null,
      sortOrder: sess.sortOrder,
    });
  }

  return { eventId: newEventId };
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
  price?: number | undefined;
  paymentMethod?: 'onsite' | 'external' | 'stripe' | undefined;
  paymentUrl?: string | undefined;
  paymentConfirm?: 'independent' | 'required' | undefined;
  /** Fediverse からのリモート参加を受け入れる枠か */
  allowRemote?: boolean | undefined;
  /** 登壇枠(参加確定者を登壇者欄にも表示) */
  isSpeakerSlot?: boolean | undefined;
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
    price: input.price ?? null,
    paymentMethod: input.paymentMethod ?? null,
    paymentUrl: input.paymentUrl ?? null,
    paymentConfirm: input.paymentConfirm ?? 'independent',
    allowRemote: input.allowRemote ?? false,
    isSpeakerSlot: input.isSpeakerSlot ?? false,
    sortOrder: existing.length,
    createdAt: now,
  });
  return { slotId };
}
