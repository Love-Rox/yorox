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
import type { AcceptJoinInput, AcceptJoinResult } from '@yorox/slot-coordinator';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from '../lib/ulid';
import { GroupBlockedError, isActorBlocked } from './blocks';
import { evaluateConditions, type ApplicantInfo } from './conditions';
import { emitDomainEvent } from './events';
import { drawRandom, drawWeighted, type LotteryApplicant } from './lottery';
import { confirmedStatus, ensurePayment, flagRefundIfPaid } from './payment';

/**
 * 先着枠の定員直列化を担う外部コーディネータ(slot-coordinator の RPC)。
 * ドメイン層を platform-free に保つため、binding は呼び出し側から注入する。
 * 未注入なら D1 の条件付き INSERT に直接フォールバックする。
 */
export interface SlotCoordinatorLike {
  acceptJoin(input: AcceptJoinInput): Promise<AcceptJoinResult>;
}

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

/** 未精算の支払いが残っているため再申込を止めた */
export class ReJoinBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReJoinBlockedError';
  }
}

async function getApplicantInfo(db: Db, actorId: string): Promise<ApplicantInfo> {
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, actorId),
  });
  if (!actor) throw new Error(`actor not found: ${actorId}`);

  // claim 済みは本体アカウント・他エイリアスの実績も合算する(参加履歴の統合)
  const identityIds = new Set([actorId]);
  const rootId = actor.claimedByActorId ?? (actor.state === 'local' ? actor.id : null);
  if (rootId) {
    identityIds.add(rootId);
    const aliases = await db.query.actors.findMany({
      where: eq(schema.actors.claimedByActorId, rootId),
    });
    for (const alias of aliases) identityIds.add(alias.id);
  }

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.attendances)
    .innerJoin(
      schema.participations,
      eq(schema.attendances.participationId, schema.participations.id),
    )
    .where(
      and(
        inArray(schema.participations.actorId, [...identityIds]),
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
  deps: { slotCoordinator?: SlotCoordinatorLike } = {},
): Promise<{ participationId: string; status: 'accepted' | 'waitlisted' | 'applied' }> {
  const now = input.now ?? new Date();
  const slot = await db.query.slots.findFirst({ where: eq(schema.slots.id, input.slotId) });
  if (!slot) throw new Error(`slot not found: ${input.slotId}`);

  // グループのブロック対象は申込を受け付けない
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, slot.eventId) });
  if (event && (await isActorBlocked(db, event.groupActorId, input.actorId))) {
    throw new GroupBlockedError();
  }

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
  // 再申込を許すため、キャンセル済みレコードを消してから入れ直す
  // (slotId+actorId は一意なので上書きではなく削除→再作成)。
  // ただし payments/attendances が参照しているため、依存行を先に片付ける。
  if (existing) {
    const payment = await db.query.payments.findFirst({
      where: eq(schema.payments.participationId, existing.id),
    });
    // 未精算(未払い・支払済み・要返金)の支払いが残っている間は再申込を止める
    // (返金記録を消さず、主催者の対応を待たせる)
    if (payment && payment.status !== 'refunded' && payment.status !== 'waived') {
      throw new ReJoinBlockedError(
        '前回の申込に未精算のお支払いが残っています。主催者の返金対応の完了後に再度お申し込みください。',
      );
    }
    await db
      .delete(schema.attendances)
      .where(eq(schema.attendances.participationId, existing.id));
    await db.delete(schema.payments).where(eq(schema.payments.participationId, existing.id));
    await db.delete(schema.participations).where(eq(schema.participations.id, existing.id));
  }

  const participationId = ulid();

  if (slot.method === 'lottery') {
    // 抽選実行後(締切超過)の申込は補欠として受ける。
    // applied で入れると cron が再抽選し、当選席が定員ぶん再付与されて超過する。
    const drawn = slot.lotteryAt != null && now.getTime() >= slot.lotteryAt.getTime();
    const status = drawn ? 'waitlisted' : 'applied';
    await db.insert(schema.participations).values({
      id: participationId,
      slotId: input.slotId,
      actorId: input.actorId,
      status,
      appliedAt: now,
    });
    await emitDomainEvent(
      db,
      drawn ? 'participation.waitlisted' : 'participation.applied',
      { participationId, slotId: input.slotId, actorId: input.actorId },
      now,
    );
    return { participationId, status };
  }

  // 先着の確定ステータス(支払い確認で確定の有料枠は payment_pending で定員保持)
  const target = confirmedStatus(slot);

  // 先着: slot-coordinator(DO)があれば slot 単位で直列化して確定する
  if (deps.slotCoordinator) {
    const result = await deps.slotCoordinator.acceptJoin({
      participationId,
      slotId: input.slotId,
      actorId: input.actorId,
      capacity: slot.capacity,
      waitlistModel: slot.waitlistModel,
      waitlistCapacity: slot.waitlistCapacity,
      appliedAtMs: now.getTime(),
      confirmStatus: target,
    });
    if (result === 'full') throw new SlotFullError();
    const status = result === 'accepted' ? target : 'waitlisted';
    if (status !== 'waitlisted') await ensurePayment(db, participationId, slot, now);
    await emitDomainEvent(
      db,
      status === 'accepted'
        ? 'participation.accepted'
        : status === 'payment_pending'
          ? 'participation.payment_pending'
          : 'participation.waitlisted',
      { participationId, slotId: input.slotId, actorId: input.actorId },
      now,
    );
    return { participationId, status: status === 'waitlisted' ? 'waitlisted' : 'accepted' };
  }

  // フォールバック: 単一ステートメントの条件付き INSERT で定員を原子的に守る
  // (payment_pending も席を保持するため定員カウントに含める)
  const acceptedInsert = await db.run(sql`
    INSERT INTO participations (id, slot_id, actor_id, status, hidden_from_list, applied_at, decided_at)
    SELECT ${participationId}, ${input.slotId}, ${input.actorId}, ${target}, 0, ${now.getTime()}, ${now.getTime()}
    WHERE (
      SELECT COUNT(*) FROM participations
      WHERE slot_id = ${input.slotId} AND status IN ('accepted', 'payment_pending', 'consent_pending')
    ) < ${slot.capacity}
  `);
  if ((acceptedInsert.meta?.changes ?? 0) > 0) {
    await ensurePayment(db, participationId, slot, now);
    await emitDomainEvent(
      db,
      target === 'accepted' ? 'participation.accepted' : 'participation.payment_pending',
      {
        participationId,
        slotId: input.slotId,
        actorId: input.actorId,
      },
      now,
    );
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

  // 支払い済みなら要返金フラグ(主催の管理コンソールに表示)
  await flagRefundIfPaid(db, participationId);

  if (participation.status === 'accepted' || participation.status === 'payment_pending') {
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

  // 空き定員の確認(payment_pending も席を保持)
  const [acceptedRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.participations)
    .where(
      and(
        eq(schema.participations.slotId, slotId),
        sql`${schema.participations.status} IN ('accepted', 'payment_pending', 'consent_pending')`,
      ),
    );
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

  const target = confirmedStatus(slot);
  // 定員を原子的に再確認して繰り上げる(join の条件付き INSERT と最終席を
  // 奪い合っても超過しないよう、単一ステートメントの条件付き UPDATE にする)
  const promoted = await db.run(sql`
    UPDATE participations SET status = ${target}, decided_at = ${now.getTime()}
    WHERE id = ${next.id} AND status = 'waitlisted' AND (
      SELECT COUNT(*) FROM participations
      WHERE slot_id = ${slotId} AND status IN ('accepted', 'payment_pending', 'consent_pending')
    ) < ${slot.capacity}
  `);
  if ((promoted.meta?.changes ?? 0) === 0) return; // 席が埋まった: 繰上せず終了
  await ensurePayment(db, next.id, slot, now);
  await emitDomainEvent(
    db,
    target === 'accepted' ? 'participation.promoted' : 'participation.payment_pending',
    {
      participationId: next.id,
      slotId,
      actorId: next.actorId,
    },
    now,
  );
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
    const participation = await db.query.participations.findFirst({
      where: eq(schema.participations.id, participationId),
    });
    const slot = participation
      ? await db.query.slots.findFirst({ where: eq(schema.slots.id, participation.slotId) })
      : null;
    const target = slot ? confirmedStatus(slot) : 'accepted';
    await db
      .update(schema.participations)
      .set({ status: target, decidedAt: now })
      .where(eq(schema.participations.id, participationId));
    if (slot) await ensurePayment(db, participationId, slot, now);
    await emitDomainEvent(
      db,
      target === 'accepted' ? 'participation.accepted' : 'participation.payment_pending',
      { participationId },
      now,
    );
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
      // 状態遷移は必ずドメインイベントを伴わせる(CLAUDE.md)
      await emitDomainEvent(
        db,
        'participation.cancelled',
        { participationId, slotId: participation.slotId, actorId: participation.actorId },
        now,
      );
      await promoteFromWaitlist(db, participation.slotId, now);
    }
  }
}

/**
 * 主催による個別判定(手動選定の抽選枠、または例外運用)。
 * applied / waitlisted の参加を当選・補欠・落選へ動かす。
 */
export async function decideParticipation(
  db: Db,
  participationId: string,
  decision: 'accepted' | 'waitlisted' | 'rejected',
  now: Date = new Date(),
): Promise<void> {
  const participation = await db.query.participations.findFirst({
    where: eq(schema.participations.id, participationId),
  });
  if (!participation) throw new Error(`participation not found: ${participationId}`);
  if (participation.status === 'cancelled') return;
  if (participation.status === decision) return;

  const slot = await db.query.slots.findFirst({
    where: eq(schema.slots.id, participation.slotId),
  });
  const effective =
    decision === 'accepted' && slot ? confirmedStatus(slot) : decision;

  await db
    .update(schema.participations)
    .set({ status: effective, decidedAt: now })
    .where(eq(schema.participations.id, participationId));
  if (decision === 'accepted' && slot) {
    await ensurePayment(db, participationId, slot, now);
  }

  const eventType =
    effective === 'accepted'
      ? 'participation.accepted'
      : effective === 'payment_pending'
        ? 'participation.payment_pending'
        : effective === 'waitlisted'
          ? 'participation.waitlisted'
          : 'participation.rejected';
  await emitDomainEvent(db, eventType, {
    participationId,
    slotId: participation.slotId,
    actorId: participation.actorId,
  }, now);
}

/**
 * 出欠の記録(attended / no_show)。既存の記録は上書きする。
 */
export async function recordAttendance(
  db: Db,
  input: {
    participationId: string;
    status: 'attended' | 'no_show';
    recordedByActorId: string;
  },
  now: Date = new Date(),
): Promise<void> {
  const existing = await db.query.attendances.findFirst({
    where: eq(schema.attendances.participationId, input.participationId),
  });
  if (existing) {
    await db
      .update(schema.attendances)
      .set({ status: input.status, recordedByActorId: input.recordedByActorId, recordedAt: now })
      .where(eq(schema.attendances.participationId, input.participationId));
  } else {
    await db.insert(schema.attendances).values({
      participationId: input.participationId,
      status: input.status,
      recordedByActorId: input.recordedByActorId,
      recordedAt: now,
    });
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

  // 既に席を持っている参加者(手動当選・繰上など)を定員から差し引く。
  // これをしないと、当選席を毎回 capacity 名ぶん引いてしまい定員を超過する。
  const [heldRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.participations)
    .where(
      and(
        eq(schema.participations.slotId, slotId),
        sql`${schema.participations.status} IN ('accepted', 'payment_pending', 'consent_pending')`,
      ),
    );
  const seats = Math.max(0, slot.capacity - (heldRow?.count ?? 0));

  const winners =
    slot.lotteryLogic === 'weighted'
      ? drawWeighted(lotteryApplicants, seats)
      : drawRandom(lotteryApplicants, seats);

  const waitlistLimit =
    slot.waitlistModel === 'separate' ? (slot.waitlistCapacity ?? 0) : Number.MAX_SAFE_INTEGER;

  let acceptedCount = 0;
  let waitlistedCount = 0;
  let rejectedCount = 0;

  for (const p of applicants) {
    if (winners.has(p.id)) {
      const target = confirmedStatus(slot);
      await db
        .update(schema.participations)
        .set({ status: target, decidedAt: now })
        .where(eq(schema.participations.id, p.id));
      await ensurePayment(db, p.id, slot, now);
      await emitDomainEvent(
        db,
        target === 'accepted' ? 'participation.accepted' : 'participation.payment_pending',
        {
          participationId: p.id,
          slotId,
          actorId: p.actorId,
        },
        now,
      );
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
