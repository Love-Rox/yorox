/**
 * 先着枠(fcfs)の参加確定を slotId 単位で直列化する Worker。
 *
 * packages/app/src/domain/participation.ts の joinSlot にある先着枠の
 * 条件付き INSERT(accepted → 満席なら waitlisted → 補欠も満席なら 'full')
 * をこの Durable Object 経由で実行し、slot 単位の直列化を保証する。
 * (docs/OPEN-QUESTIONS.md 「3. 先着枠の定員直列化」)
 *
 * 補足: D1 自体も単一書き込みであり、条件付き INSERT の SQL 文単体は原子的。
 * ただし DO の自動 input gate は ctx.storage 操作にのみ働き、D1 バインディング
 * 呼び出し(サブリクエスト)の await 中は同一インスタンスへの別の RPC 呼び出しが
 * 割り込みうる。そのため acceptJoin はインスタンス内で明示的にチェーンして
 * 直列化する。
 */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';

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

/**
 * slotId をインスタンス名として呼び出す DO。
 * 参加確定処理(先着枠の条件付き INSERT)を1インスタンス内で直列に処理し、
 * 定員超過(オーバーブッキング)を防ぐ。
 */
export class SlotSerializer extends DurableObject<Env> {
  /** 同一インスタンス内の acceptJoin 呼び出しを直列に実行するためのチェーン */
  #chain: Promise<unknown> = Promise.resolve();

  async acceptJoin(input: AcceptJoinInput): Promise<AcceptJoinResult> {
    const result = this.#chain.then(() => this.#acceptJoinSerialized(input));
    // 直前の呼び出しが失敗してもチェーンが途切れないようにしておく
    this.#chain = result.catch(() => undefined);
    return result;
  }

  async #acceptJoinSerialized(input: AcceptJoinInput): Promise<AcceptJoinResult> {
    const {
      participationId,
      slotId,
      actorId,
      capacity,
      waitlistModel,
      waitlistCapacity,
      appliedAtMs,
    } = input;

    // 定員内なら即 accepted(participation.ts の先着パスと同じ条件付き INSERT)
    const acceptedInsert = await this.env.DB.prepare(
      `INSERT INTO participations (id, slot_id, actor_id, status, hidden_from_list, applied_at, decided_at)
       SELECT ?, ?, ?, 'accepted', 0, ?, ?
       WHERE (
         SELECT COUNT(*) FROM participations
         WHERE slot_id = ? AND status = 'accepted'
       ) < ?`,
    )
      .bind(participationId, slotId, actorId, appliedAtMs, appliedAtMs, slotId, capacity)
      .run();
    if ((acceptedInsert.meta?.changes ?? 0) > 0) {
      return 'accepted';
    }

    // 定員オーバー → 補欠へ
    // connpass モデル: 補欠は無制限 / separate モデル: 主催が設定した補欠定員まで
    const waitlistLimit =
      waitlistModel === 'separate' ? (waitlistCapacity ?? 0) : Number.MAX_SAFE_INTEGER;
    const waitlistInsert = await this.env.DB.prepare(
      `INSERT INTO participations (id, slot_id, actor_id, status, hidden_from_list, applied_at)
       SELECT ?, ?, ?, 'waitlisted', 0, ?
       WHERE (
         SELECT COUNT(*) FROM participations
         WHERE slot_id = ? AND status IN ('waitlisted', 'consent_pending')
       ) < ?`,
    )
      .bind(participationId, slotId, actorId, appliedAtMs, slotId, waitlistLimit)
      .run();
    if ((waitlistInsert.meta?.changes ?? 0) > 0) {
      return 'waitlisted';
    }

    // 補欠も満席
    return 'full';
  }
}

/**
 * app 側から service binding 経由で呼ばれる入口。
 * slotId から対応する DO インスタンスを決定し、acceptJoin を委譲する。
 */
export default class SlotCoordinator extends WorkerEntrypoint<Env> {
  async acceptJoin(input: AcceptJoinInput): Promise<AcceptJoinResult> {
    const id = this.env.SLOT_DO.idFromName(input.slotId);
    const stub = this.env.SLOT_DO.get(id);
    return stub.acceptJoin(input);
  }

  // RPC 専用 Worker だが、直接 HTTP で叩かれた場合のフォールバック
  async fetch(): Promise<Response> {
    return new Response('Not Found', { status: 404 });
  }
}
