/**
 * 枠の参加条件(宣言的ルールの AND 組合せ)の評価。純粋関数。
 *
 * AP 写像: 条件を満たさない Join には理由付き Reject
 * (summary に人間可読の説明を載せる)。
 */
import type { SlotConditions } from '../db/schema';

export interface ApplicantInfo {
  /** actors.state */
  state: 'local' | 'remote_unclaimed' | 'remote_claimed';
  /** アカウント作成日時 */
  createdAt: Date;
  /** 出席実績(attended)の回数 */
  attendedCount: number;
}

export type ConditionResult = { ok: true } | { ok: false; reason: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function evaluateConditions(
  conditions: SlotConditions | null | undefined,
  applicant: ApplicantInfo,
  now: Date = new Date(),
): ConditionResult {
  if (!conditions) return { ok: true };

  if (conditions.requireClaimed) {
    if (applicant.state === 'remote_unclaimed') {
      return {
        ok: false,
        reason:
          '参加にはアカウントの claim(本人確認)が必要です。ログインしてアカウントを紐付けてください。',
      };
    }
  }

  if (conditions.minAccountAgeDays !== undefined) {
    const ageDays = (now.getTime() - applicant.createdAt.getTime()) / DAY_MS;
    if (ageDays < conditions.minAccountAgeDays) {
      return {
        ok: false,
        reason: `参加にはアカウント作成から${conditions.minAccountAgeDays}日以上の経過が必要です。`,
      };
    }
  }

  if (conditions.minAttendedCount !== undefined) {
    if (applicant.attendedCount < conditions.minAttendedCount) {
      return {
        ok: false,
        reason: `参加には過去${conditions.minAttendedCount}回以上の参加実績が必要です。`,
      };
    }
  }

  return { ok: true };
}
