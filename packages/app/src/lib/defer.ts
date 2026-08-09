/**
 * リクエスト応答後のバックグラウンド処理。
 * Workers では ExecutionContext.waitUntil、Node(Docker)では
 * fire-and-forget にフォールバックする。
 */
import type { Context } from 'hono';

export function deferWork(c: Context, promise: Promise<unknown>): void {
  const guarded = promise.catch((err) => {
    console.error('[defer] background task failed:', err);
  });
  try {
    c.executionCtx.waitUntil(guarded);
  } catch {
    // Node ランタイム: ExecutionContext が無いので投げっぱなしで実行
    void guarded;
  }
}
