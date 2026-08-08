/**
 * RPC の公開型。app 側はこのファイルだけを import する
 * (index.ts は Worker ランタイム型 Env に依存するため、型利用側に巻き込まない)。
 */

/** 先着枠の参加確定処理に必要な入力 */
export interface AcceptJoinInput {
  participationId: string;
  slotId: string;
  actorId: string;
  capacity: number;
  waitlistModel: 'connpass' | 'separate';
  waitlistCapacity: number | null;
  /** 申込時刻(epoch ミリ秒)。applied_at / decided_at に使う */
  appliedAtMs: number;
  /**
   * 確定時に入れるステータス。
   * 無料枠・支払い独立の有料枠は 'accepted'、
   * 支払い確認で確定の有料枠は 'payment_pending'(どちらも定員を保持する)
   */
  confirmStatus: 'accepted' | 'payment_pending';
}

export type AcceptJoinResult = 'accepted' | 'waitlisted' | 'full';
