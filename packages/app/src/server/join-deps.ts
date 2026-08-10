/**
 * joinSlot に渡す依存(定員直列化コーディネータ / Discord Bot トークン)を
 * 一箇所で組み立てる。Web・ActivityPub・MCP のどの入口から申し込んでも
 * 同じ参加条件が効くようにするため、呼び出し側はこれを使うこと。
 */
import type { SlotCoordinatorLike } from '../domain/participation';
import { getSlotCoordinator } from './coordinator';

export interface JoinDeps {
  slotCoordinator?: SlotCoordinatorLike;
  discordBotToken?: string;
}

export async function buildJoinDeps(
  coordinator?: SlotCoordinatorLike | undefined,
): Promise<JoinDeps> {
  const slotCoordinator = coordinator ?? (await getSlotCoordinator());
  // env は workerd 内でのみ解決されるので、静的 import せず遅延で取る
  const { env } = await import('cloudflare:workers');
  const discordBotToken = (env as Env).DISCORD_BOT_TOKEN;
  return {
    ...(slotCoordinator ? { slotCoordinator } : {}),
    ...(discordBotToken ? { discordBotToken } : {}),
  };
}
