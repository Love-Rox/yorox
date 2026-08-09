/**
 * 支払いのドメインサービス。
 *
 * MVP は現地払い / 外部決済リンク+主催の手動確認。
 * 将来の Stripe 等は provider/provider_ref を使い、webhook が markPayment を呼ぶ
 * (支払いの「確認手段」だけが変わり、状態遷移はここに集約される)。
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from '../lib/ulid';
import { emitDomainEvent } from './events';

type Slot = typeof schema.slots.$inferSelect;

/** 有料枠か */
export function isPaidSlot(slot: Slot): boolean {
  return slot.price != null && slot.price > 0 && slot.paymentMethod != null;
}

/**
 * 参加確定時に入るべき状態。
 * 支払い確認で確定(required)の有料枠は payment_pending(定員は保持)。
 */
export function confirmedStatus(slot: Slot): 'accepted' | 'payment_pending' {
  return isPaidSlot(slot) && slot.paymentConfirm === 'required'
    ? 'payment_pending'
    : 'accepted';
}

/** 有料枠なら pending の支払いレコードを用意する(既存があれば何もしない) */
export async function ensurePayment(
  db: Db,
  participationId: string,
  slot: Slot,
  now: Date = new Date(),
): Promise<void> {
  if (!isPaidSlot(slot)) return;
  const existing = await db.query.payments.findFirst({
    where: eq(schema.payments.participationId, participationId),
  });
  if (existing) return;
  await db.insert(schema.payments).values({
    id: ulid(),
    participationId,
    amount: slot.price!,
    currency: slot.currency,
    method: slot.paymentMethod!,
    createdAt: now,
  });
}

/**
 * 支払い状態の変更(主催の手動マーク。将来は webhook からも呼ばれる)。
 * paid / waived で参加が payment_pending なら accepted に確定する。
 */
export async function markPayment(
  db: Db,
  paymentId: string,
  newStatus: 'paid' | 'refunded' | 'no_refund' | 'waived',
  markedByActorId: string,
  now: Date = new Date(),
): Promise<void> {
  const payment = await db.query.payments.findFirst({
    where: eq(schema.payments.id, paymentId),
  });
  if (!payment) throw new Error('支払いが見つかりません');

  await db
    .update(schema.payments)
    .set({
      status: newStatus,
      markedByActorId,
      paidAt: newStatus === 'paid' ? now : payment.paidAt,
    })
    .where(eq(schema.payments.id, paymentId));

  if (newStatus === 'paid' || newStatus === 'waived') {
    const participation = await db.query.participations.findFirst({
      where: eq(schema.participations.id, payment.participationId),
    });
    if (participation?.status === 'payment_pending') {
      await db
        .update(schema.participations)
        .set({ status: 'accepted', decidedAt: now })
        .where(eq(schema.participations.id, participation.id));
      await emitDomainEvent(db, 'participation.accepted', {
        participationId: participation.id,
        slotId: participation.slotId,
        actorId: participation.actorId,
      }, now);
    }
    if (newStatus === 'paid') {
      await emitDomainEvent(db, 'payment.paid', {
        paymentId,
        participationId: payment.participationId,
      }, now);
    }
  }
}

/**
 * キャンセル時の支払い後始末: 支払い済みなら要返金フラグを立てる。
 */
export async function flagRefundIfPaid(
  db: Db,
  participationId: string,
): Promise<void> {
  const payment = await db.query.payments.findFirst({
    where: eq(schema.payments.participationId, participationId),
  });
  if (payment?.status === 'paid') {
    await db
      .update(schema.payments)
      .set({ status: 'refund_required' })
      .where(eq(schema.payments.id, payment.id));
  }
}
