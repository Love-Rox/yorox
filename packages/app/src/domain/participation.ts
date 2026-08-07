/**
 * 参加フローのドメインサービス(docs/DECISIONS.md「参加フロー / 枠ポリシー」)。
 *
 * 状態遷移:
 *   applied(抽選待ち) → accepted / waitlisted / rejected
 *   waitlisted → accepted(自動繰上) / consent_pending(承諾型繰上) → accepted
 *   任意 → cancelled
 *
 * 先着枠の定員は D1 の単一ステートメント(条件付き INSERT)の原子性で守る。
 * D1 は単一書き込みなので MVP 規模ではこれで十分(docs/OPEN-QUESTIONS.md #3)。
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from '../lib/ulid';
import { evaluateConditions, type ApplicantInfo } from './conditions';
import { emitDomainEvent } from './events';
import { drawRandom, drawWeighted, type LotteryApplicant } from './lottery';

export class SlotFullError extends Error {
  constructor() {
    super('この枠は満席です(補欠枠も含む)');
    this.name = 'SlotFullError';
  }
}

export class ConditionNotMetError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'ConditionNotMetError';
  }
}

export class AlreadyJoinedError extends Error {
  constructor() {
    super('この枠には既に申し込み済みです');
    this.name = 'AlreadyJoinedError';
  }
}

async function getApplicantInfo(db: Db, actorId: string): Promise<ApplicantInfo> {
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, actorId),
  });
  if (!actor) throw new Error(`actor not found: ${actorId}`);

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.attendances)
    .innerJoin(
      schema.participations,
      eq(schema.attendances.participationId, schema.participations.id),
    )
    .where(
      and(
        eq(schema.participations.actorId, actorId),
        eq(schema.attendances.status, 'attended'),
      ),
    );

  return {
    state: actor.state,
    createdAt: actor.createdAt,
    attendedCount: row?.count ?? 0,
  };
}

/**
 * 枠への参加申込。
 * - 参加条件を評価し、満たさなければ ConditionNotMetError(理由付き)
 * - 先着: 定員内なら即 accepted、溢れたら補欠(補欠も満席なら SlotFullError)
 * - 抽選: applied で受け付け、抽選実行まで保留
 */
export async function joinSlot(
  db: Db,
  input: { slotId: string; actorId: string; now?: Date },
): Promise<{ participationId: string; status: 'accepted' | 'waitlisted' | 'applied' }> {
  const now = input.now ?? new Date();
  const slot = await db.query.slots.findFirst({ where: eq(schema.slots.id, input.slotId) });
  if (!slot) throw new Error(`slot not found: ${input.slotId}`);

  const applicant = await getApplicantInfo(db, input.actorId);
  const condResult = evaluateConditions(slot.conditions, applicant, now);
  if (!condResult.ok) throw new ConditionNotMetError(condResult.reason);

  const existing = await db.query.participations.findFirst({
    where: and(
      eq(schema.participations.slotId, input.slotId),
      eq(schema.participations.actorId, input.actorId),
    ),
  });
  if (existing && existing.status !== 'cancelled') throw new AlreadyJoinedError();
  // 再申込を許すため、キャンセル済みレコードは消してから入れ直す
  if (existing) {
    await db.delete(schema.participations).where(eq(schema.participations.id, existing.id));
  }

  const participationId = ulid();

  if (slot.method === 'lottery') {
    await db.insert(schema.participations).values({
      id: participationId,
      slotId: input.slotId,
      actorId: input.actorId,
      status: 'applied',
      appliedAt: now,
    });
    await emitDomainEvent(db, 'participation.applied', {
      participationId,
      slotId: input.slotId,
      actorId: input.actorId,
    }, now);
    return { participationId, status: 'applied' };
  }

  // 先着: 単一ステートメントの条件付き INSERT で定員を原子的に守る
  const acceptedInsert = await db.run(sql`
    INSERT INTO participations (id, slot_id, actor_id, status, hidden_from_list, applied_at, decided_at)
    SELECT ${participationId}, ${input.slotId}, ${input.actorId}, 'accepted', 0, ${now.getTime()}, ${now.getTime()}
    WHERE (
      SELECT COUNT(*) FROM participations
      WHERE slot_id = ${input.slotId} AND status = 'accepted'
    ) < ${slot.capacity}
  `);
  if ((acceptedInsert.meta?.changes ?? 0) > 0) {
    await emitDomainEvent(db, 'participation.accepted', {
      participationId,
      slotId: input.slotId,
      actorId: input.actorId,
    }, now);
    return { participationId, status: 'accepted' };
  }

  // 定員オーバー → 補欠へ
  // connpass モデル: 補欠は無制限 / separate モデル: 主催が設定した補欠定員まで
  const waitlistLimit =
    slot.waitlistModel === 'separate' ? (slot.waitlistCapacity ?? 0) : Number.MAX_SAFE_INTEGER;
  const waitlistInsert = await db.run(sql`
    INSERT INTO participations (id, slot_id, actor_id, status, hidden_from_list, applied_at)
    SELECT ${participationId}, ${input.slotId}, ${input.actorId}, 'waitlisted', 0, ${now.getTime()}
    WHERE (
      SELECT COUNT(*) FROM participations
      WHERE slot_id = ${input.slotId} AND status IN ('waitlisted', 'consent_pending')
    ) < ${waitlistLimit}
  `);
  if ((waitlistInsert.meta?.changes ?? 0) > 0) {
    await emitDomainEvent(db, 'participation.waitlisted', {
      participationId,
      slotId: input.slotId,
      actorId: input.actorId,
    }, now);
    return { participationId, status: 'waitlisted' };
  }

  throw new SlotFullError();
}

/**
 * 参加キャンセル。accepted のキャンセルなら繰上処理を試みる。
 */
export async function cancelParticipation(
  db: Db,
  participationId: string,
  now: Date = new Date(),
): Promise<void> {
  const participation = await db.query.participations.findFirst({
    where: eq(schema.participations.id, participationId),
  });
  if (!participation || participation.status === 'cancelled') return;

  await db
    .update(schema.participations)
    .set({ status: 'cancelled', cancelledAt: now })
    .where(eq(schema.participations.id, participationId));

  await emitDomainEvent(db, 'participation.cancelled', {
    participationId,
    slotId: participation.slotId,
    actorId: participation.actorId,
  }, now);

  if (participation.status === 'accepted') {
    await promoteFromWaitlist(db, participation.slotId, now);
  }
}

/**
 * 補欠から1人繰り上げる(空きが出たとき・締切前チェック付き)。
 * 繰上ポリシー:
 * - auto: 即時 accepted
 * - auto_deadline: 開催 X 時間前まで自動、以降は停止
 * - consent: consent_pending にしてアクション要求を発行(本人承諾で確定)
 */
export async function promoteFromWaitlist(
  db: Db,
  slotId: string,
  now: Date = new Date(),
): Promise<void> {
  const slot = await db.query.slots.findFirst({ where: eq(schema.slots.id, slotId) });
  if (!slot) return;

  if (slot.promotionPolicy === 'auto_deadline') {
    const event = await db.query.events.findFirst({ where: eq(schema.events.id, slot.eventId) });
    if (event) {
      const deadlineMs =
        event.startsAt.getTime() - (slot.promotionDeadlineHours ?? 0) * 60 * 60 * 1000;
      if (now.getTime() >= deadlineMs) return; // 締切超過: 繰上停止
    }
  }

  // 空き定員の確認(accepted 数 < capacity のときだけ繰り上げる)
  const [acceptedRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.participations)
    .where(and(eq(schema.participations.slotId, slotId), eq(schema.participations.status, 'accepted')));
  if ((acceptedRow?.count ?? 0) >= slot.capacity) return;

  const next = await db.query.participations.findFirst({
    where: and(
      eq(schema.participations.slotId, slotId),
      eq(schema.participations.status, 'waitlisted'),
    ),
    orderBy: [asc(schema.participations.appliedAt)],
  });
  if (!next) return;

  if (slot.promotionPolicy === 'consent') {
    // 承諾型はローカル/claim済みユーザー向け(未claimリモートには承諾UIを出せない)
    await db
      .update(schema.participations)
      .set({ status: 'consent_pending' })
      .where(eq(schema.participations.id, next.id));
    await db.insert(schema.actionRequests).values({
      id: ulid(),
      actorId: next.actorId,
      type: 'promotion.consent',
      payload: { participationId: next.id, slotId },
      status: 'pending',
      createdAt: now,
    });
    await emitDomainEvent(db, 'participation.consent_requested', {
      participationId: next.id,
      slotId,
      actorId: next.actorId,
    }, now);
    return;
  }

  await db
    .update(schema.participations)
    .set({ status: 'accepted', decidedAt: now })
    .where(eq(schema.participations.id, next.id));
  await emitDomainEvent(db, 'participation.promoted', {
    participationId: next.id,
    slotId,
    actorId: next.actorId,
  }, now);
}

/**
 * 承諾型繰上への本人応答。
 */
export async function respondToPromotion(
  db: Db,
  input: { actionRequestId: string; accept: boolean; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const request = await db.query.actionRequests.findFirst({
    where: eq(schema.actionRequests.id, input.actionRequestId),
  });
  if (!request || request.status !== 'pending') return;

  const participationId = (request.payload as { participationId: string }).participationId;

  await db
    .update(schema.actionRequests)
    .set({ status: input.accept ? 'completed' : 'declined', respondedAt: now })
    .where(eq(schema.actionRequests.id, request.id));

  if (input.accept) {
    await db
      .update(schema.participations)
      .set({ status: 'accepted', decidedAt: now })
      .where(eq(schema.participations.id, participationId));
    await emitDomainEvent(db, 'participation.accepted', { participationId }, now);
  } else {
    // 辞退: キャンセル扱いにして次の補欠へ
    const participation = await db.query.participations.findFirst({
      where: eq(schema.participations.id, participationId),
    });
    await db
      .update(schema.participations)
      .set({ status: 'cancelled', cancelledAt: now })
      .where(eq(schema.participations.id, participationId));
    if (participation) {
      await promoteFromWaitlist(db, participation.slotId, now);
    }
  }
}

/**
 * 抽選の実行(Cron Trigger または主催の手動実行から呼ぶ)。
 * - random / weighted: 当選者を accepted、落選者を補欠モデルに従って処理
 * - manual は対象外(主催が UI から個別に確定する)
 */
export async function runLottery(
  db: Db,
  slotId: string,
  now: Date = new Date(),
): Promise<{ accepted: number; waitlisted: number; rejected: number }> {
  const slot = await db.query.slots.findFirst({ where: eq(schema.slots.id, slotId) });
  if (!slot) throw new Error(`slot not found: ${slotId}`);
  if (slot.method !== 'lottery') throw new Error('先着枠に抽選は実行できません');
  if (slot.lotteryLogic === 'manual') throw new Error('手動選定の枠です');

  const applicants = await db.query.participations.findMany({
    where: and(
      eq(schema.participations.slotId, slotId),
      eq(schema.participations.status, 'applied'),
    ),
    orderBy: [asc(schema.participations.appliedAt)],
  });
  if (applicants.length === 0) return { accepted: 0, waitlisted: 0, rejected: 0 };

  let lotteryApplicants: LotteryApplicant[];
  if (slot.lotteryLogic === 'weighted') {
    // 出欠実績を集計して重みに使う
    lotteryApplicants = [];
    for (const p of applicants) {
      const [attendedRow] = await db
        .select({
          attended: sql<number>`sum(case when ${schema.attendances.status} = 'attended' then 1 else 0 end)`,
          noShow: sql<number>`sum(case when ${schema.attendances.status} = 'no_show' then 1 else 0 end)`,
        })
        .from(schema.attendances)
        .innerJoin(
          schema.participations,
          eq(schema.attendances.participationId, schema.participations.id),
        )
        .where(eq(schema.participations.actorId, p.actorId));
      lotteryApplicants.push({
        participationId: p.id,
        attendedCount: attendedRow?.attended ?? 0,
        noShowCount: attendedRow?.noShow ?? 0,
      });
    }
  } else {
    lotteryApplicants = applicants.map((p) => ({ participationId: p.id }));
  }

  const winners =
    slot.lotteryLogic === 'weighted'
      ? drawWeighted(lotteryApplicants, slot.capacity)
      : drawRandom(lotteryApplicants, slot.capacity);

  const waitlistLimit =
    slot.waitlistModel === 'separate' ? (slot.waitlistCapacity ?? 0) : Number.MAX_SAFE_INTEGER;

  let acceptedCount = 0;
  let waitlistedCount = 0;
  let rejectedCount = 0;

  for (const p of applicants) {
    if (winners.has(p.id)) {
      await db
        .update(schema.participations)
        .set({ status: 'accepted', decidedAt: now })
        .where(eq(schema.participations.id, p.id));
      await emitDomainEvent(db, 'participation.accepted', {
        participationId: p.id,
        slotId,
        actorId: p.actorId,
      }, now);
      acceptedCount++;
    } else if (waitlistedCount < waitlistLimit) {
      // 落選 → 補欠(connpass モデルは無制限、separate は定員まで)
      await db
        .update(schema.participations)
        .set({ status: 'waitlisted', decidedAt: now })
        .where(eq(schema.participations.id, p.id));
      await emitDomainEvent(db, 'participation.waitlisted', {
        participationId: p.id,
        slotId,
        actorId: p.actorId,
      }, now);
      waitlistedCount++;
    } else {
      await db
        .update(schema.participations)
        .set({ status: 'rejected', decidedAt: now })
        .where(eq(schema.participations.id, p.id));
      await emitDomainEvent(db, 'participation.rejected', {
        participationId: p.id,
        slotId,
        actorId: p.actorId,
      }, now);
      rejectedCount++;
    }
  }

  await emitDomainEvent(db, 'lottery.completed', {
    slotId,
    accepted: acceptedCount,
    waitlisted: waitlistedCount,
    rejected: rejectedCount,
  }, now);

  return { accepted: acceptedCount, waitlisted: waitlistedCount, rejected: rejectedCount };
}
