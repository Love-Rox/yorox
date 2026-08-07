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
}

export type AcceptJoinResult = 'accepted' | 'waitlisted' | 'full';
