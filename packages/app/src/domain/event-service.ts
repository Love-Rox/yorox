/**
 * イベントの作成・公開・枠追加のドメインサービス。
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import type { SlotConditions } from '../db/schema';
import { ulid } from '../lib/ulid';
import { emitDomainEvent } from './events';
import { flagRefundIfPaid } from './payment';

export interface CreateEventInput {
  groupActorId: string;
  title: string;
  descriptionMd?: string | undefined;
  participantInfoMd?: string | undefined;
  thumbnailUrl?: string | undefined;
  hashtags?: string[] | undefined;
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
    hashtags: input.hashtags ?? null,
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
  hashtags?: string[] | undefined;
  startsAt: Date;
  endsAt?: Date | undefined;
  venueName?: string | undefined;
  venueAddress?: string | undefined;
  venueLat?: number | undefined;
  venueLng?: number | undefined;
  onlineUrl?: string | undefined;
  sessionsLabel?: 'sessions' | 'timetable' | undefined;
  remoteJoinMethods?: ('reply' | 'join')[] | undefined;
  /** イベント全体の合計定員(会場キャパ)。undefined/null = 制限なし */
  totalCapacity?: number | undefined;
  /** 参加者一覧を公開するか */
  participantListPublic?: boolean | undefined;
  /** 参加未確定(抽選待ち・補欠)の申込者も一覧に載せるか */
  applicantListPublic?: boolean | undefined;
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
      hashtags: input.hashtags ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      venueName: input.venueName ?? null,
      venueAddress: input.venueAddress ?? null,
      venueLat: input.venueLat ?? null,
      venueLng: input.venueLng ?? null,
      onlineUrl: input.onlineUrl ?? null,
      sessionsLabel: input.sessionsLabel ?? 'sessions',
      remoteJoinMethods: input.remoteJoinMethods ?? ['reply', 'join'],
      totalCapacity: input.totalCapacity ?? null,
      participantListPublic: input.participantListPublic ?? true,
      applicantListPublic: input.applicantListPublic ?? false,
      updatedAt: now,
    })
    .where(eq(schema.events.id, eventId));
}

/**
 * 下書きイベントを公開する。
 * visibility='unlisted'(限定公開)は URL を知る人だけが閲覧・申込でき、
 * 一覧・検索・連合告知には流さないため event.published は発行しない。
 */
export async function publishEvent(
  db: Db,
  eventId: string,
  now: Date = new Date(),
  visibility: 'public' | 'unlisted' = 'public',
): Promise<void> {
  const existing = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
  const firstPublish = !existing?.publishedAt;
  await db
    .update(schema.events)
    .set({
      visibility,
      // 限定公開 → 公開などの切り替えで公開日時を上書きしない(タイムラインの並びも保つ)
      publishedAt: existing?.publishedAt ?? now,
      publishAt: null,
      updatedAt: now,
    })
    .where(eq(schema.events.id, eventId));
  // 告知(AP fan-out・フォロワー通知)は初回公開のときだけ。
  // 限定公開に戻して再公開するたびに再告知しない
  if (visibility === 'public' && firstPublish) {
    await emitDomainEvent(db, 'event.published', { eventId }, now);
  }
}

/**
 * イベントを中止する。
 * - events.cancelledAt / cancelReason を記録(以後は新規申込を締め切る)
 * - 席を持っていた参加者に event.cancelled を通知
 * - 支払い済みがあれば要返金フラグを立てる(実際の返金は主催が管理画面で対応)
 * 参加レコードは履歴として残す(誰が申し込んでいたかを主催が追えるようにする)。
 */
export async function cancelEvent(
  db: Db,
  eventId: string,
  reason: string | null,
  now: Date = new Date(),
): Promise<{ notified: number }> {
  await db
    .update(schema.events)
    .set({ cancelledAt: now, cancelReason: reason, updatedAt: now })
    .where(eq(schema.events.id, eventId));

  // 席を持っている/待っている参加者(キャンセル済み・落選を除く)へ通知
  const rows = await db
    .select({
      id: schema.participations.id,
      slotId: schema.participations.slotId,
      actorId: schema.participations.actorId,
    })
    .from(schema.participations)
    .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
    .where(
      and(
        eq(schema.slots.eventId, eventId),
        inArray(schema.participations.status, [
          'applied',
          'accepted',
          'payment_pending',
          'waitlisted',
          'consent_pending',
        ]),
      ),
    );

  for (const r of rows) {
    await emitDomainEvent(
      db,
      'event.cancelled',
      { eventId, participationId: r.id, slotId: r.slotId, actorId: r.actorId },
      now,
    );
    // 支払い済みなら要返金として主催の管理画面に出す
    await flagRefundIfPaid(db, r.id);
  }
  return { notified: rows.length };
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
    hashtags: src.hashtags,
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
    totalCapacity: src.totalCapacity,
    participantListPublic: src.participantListPublic,
    applicantListPublic: src.applicantListPublic,
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

/** 枠の編集・削除を断る理由(呼び出し側がそのまま画面に出す) */
export class SlotEditBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlotEditBlockedError';
  }
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
  // 抽選日時が無いと cron が拾えず、申込者が永久に「抽選待ち」で止まる
  if (input.method === 'lottery' && !input.lotteryAt) {
    throw new SlotEditBlockedError(
      '抽選枠には抽選日時が必要です。日時を決めずに募集したい場合は先着枠にしてください。',
    );
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

/** 枠に生きている申込(キャンセル以外)が何件あるか */
async function countLiveParticipations(db: Db, slotId: string): Promise<number> {
  const rows = await db.query.participations.findMany({
    where: eq(schema.participations.slotId, slotId),
  });
  return rows.filter((r) => r.status !== 'cancelled').length;
}

export interface UpdateSlotInput {
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
  allowRemote?: boolean | undefined;
  isSpeakerSlot?: boolean | undefined;
}

/**
 * 参加枠を更新する。
 *
 * 申込が入ったあとに変えると既存の参加者の扱いが壊れる項目は断る:
 * - 方式(先着 ↔ 抽選): 状態機械が違うため、accepted と applied が混ざる
 * - 補欠モデル: 繰上の順序・母数の意味が変わる
 * - 金額 / 支払方法: 支払済みの人と新規で条件が食い違う
 *
 * 定員の増減は許す(減らしても既存の確定者は取り消さない。connpass と同じく
 * 「これ以上受け付けない」という意味になる)。
 */
export async function updateSlot(
  db: Db,
  slotId: string,
  input: UpdateSlotInput,
): Promise<void> {
  const slot = await db.query.slots.findFirst({ where: eq(schema.slots.id, slotId) });
  if (!slot) throw new Error(`slot not found: ${slotId}`);

  if (!input.name.trim()) throw new Error('枠名は必須です');
  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    throw new Error('定員は1以上の整数が必要です');
  }
  if (input.method === 'lottery' && !input.lotteryLogic) {
    throw new Error('抽選枠には抽選ロジックの指定が必要です');
  }
  if (input.method === 'lottery' && !input.lotteryAt) {
    throw new SlotEditBlockedError(
      '抽選枠には抽選日時が必要です。日時を決めずに募集したい場合は先着枠にしてください。',
    );
  }

  const live = await countLiveParticipations(db, slotId);
  if (live > 0) {
    if (input.method !== slot.method) {
      throw new SlotEditBlockedError(
        '申込が入っている枠では、先着と抽選を切り替えられません。新しい枠を作ってください。',
      );
    }
    if (input.waitlistModel !== slot.waitlistModel) {
      throw new SlotEditBlockedError(
        '申込が入っている枠では、補欠モデルを変更できません。',
      );
    }
    const nextPrice = input.price ?? null;
    if (nextPrice !== slot.price) {
      throw new SlotEditBlockedError(
        '申込が入っている枠では、参加費を変更できません。新しい枠を作ってください。',
      );
    }
    const nextPaymentMethod = nextPrice != null && nextPrice > 0 ? (input.paymentMethod ?? null) : null;
    if (nextPaymentMethod !== slot.paymentMethod) {
      throw new SlotEditBlockedError(
        '申込が入っている枠では、支払方法を変更できません。',
      );
    }
  }

  // 抽選済みの枠で抽選日時を動かすと、cron が再抽選して当選席が二重に出る
  const drawn = slot.method === 'lottery' && slot.lotteryAt != null && slot.lotteryAt <= new Date();
  if (drawn && input.lotteryAt?.getTime() !== slot.lotteryAt?.getTime()) {
    throw new SlotEditBlockedError('抽選が終わった枠では、抽選日時を変更できません。');
  }

  const price = input.price ?? null;
  const paid = price != null && price > 0;
  await db
    .update(schema.slots)
    .set({
      name: input.name.trim(),
      capacity: input.capacity,
      method: input.method,
      waitlistModel: input.waitlistModel,
      waitlistCapacity: input.waitlistCapacity ?? null,
      promotionPolicy: input.promotionPolicy,
      promotionDeadlineHours: input.promotionDeadlineHours ?? null,
      lotteryLogic: input.method === 'lottery' ? (input.lotteryLogic ?? 'random') : null,
      lotteryAt: input.method === 'lottery' ? (input.lotteryAt ?? null) : null,
      conditions: input.conditions ?? null,
      price: price,
      paymentMethod: paid ? (input.paymentMethod ?? null) : null,
      paymentUrl: paid && input.paymentMethod === 'external' ? (input.paymentUrl ?? null) : null,
      paymentConfirm: input.paymentConfirm ?? 'independent',
      allowRemote: input.allowRemote ?? false,
      isSpeakerSlot: input.isSpeakerSlot ?? false,
    })
    .where(eq(schema.slots.id, slotId));
}

/**
 * 参加枠を削除する。
 * 申込が一件でも生きているうちは消させない(参加者の記録を黙って失わせないため)。
 * キャンセル済みの申込だけが残っている場合は、支払い・出欠の記録ごと片付ける。
 */
export async function deleteSlot(db: Db, slotId: string): Promise<void> {
  const slot = await db.query.slots.findFirst({ where: eq(schema.slots.id, slotId) });
  if (!slot) throw new Error(`slot not found: ${slotId}`);

  const live = await countLiveParticipations(db, slotId);
  if (live > 0) {
    throw new SlotEditBlockedError(
      '申込が入っている枠は削除できません。先に参加者の申込をキャンセルしてください。',
    );
  }

  // 残っているのはキャンセル済みのみ。参照している行から順に片付ける
  const stale = await db.query.participations.findMany({
    where: eq(schema.participations.slotId, slotId),
  });
  for (const p of stale) {
    await db.delete(schema.attendances).where(eq(schema.attendances.participationId, p.id));
    await db.delete(schema.payments).where(eq(schema.payments.participationId, p.id));
  }
  await db.delete(schema.participations).where(eq(schema.participations.slotId, slotId));
  await db.delete(schema.slots).where(eq(schema.slots.id, slotId));
}
