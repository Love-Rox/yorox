/**
 * slot-coordinator(service binding)の境界ヘルパー。
 * wrangler types は service binding を素の Fetcher として生成するため、
 * RPC の型はここで @yorox/slot-coordinator の公開型に付け替える。
 * binding 未接続(ローカル単体起動や Docker 版)なら undefined を返し、
 * ドメイン層は D1 直接のフォールバックを使う。
 */
import type { SlotCoordinatorLike } from '../domain/participation';

export async function getSlotCoordinator(): Promise<SlotCoordinatorLike | undefined> {
  const { env } = await import('cloudflare:workers');
  const binding = (env as { SLOT_COORDINATOR?: unknown }).SLOT_COORDINATOR;
  if (!binding || typeof (binding as SlotCoordinatorLike).acceptJoin !== 'function') {
    return undefined;
  }
  return binding as SlotCoordinatorLike;
}
