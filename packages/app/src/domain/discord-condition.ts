/**
 * 「指定した Discord サーバーの参加者だけが申し込める」枠の条件。
 *
 * 他の参加条件(domain/conditions.ts)は純粋関数で評価できるが、これは
 * Discord API への問い合わせを伴うため別モジュールに分けている。
 *
 * 判定できなかったとき(Bot 未設定・Discord 障害・Bot が対象サーバーに
 * 居ない)は **安全側に倒して申込を断る**。限定公開の枠を守るための条件なので、
 * 確認が取れないまま通すと条件が意味を成さなくなる。
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { checkDiscordGuildMember } from '../lib/discord';
import type { ConditionResult } from './conditions';

/**
 * 枠とグループの設定から、所属を要求する Discord サーバー ID を決める。
 * 枠ごとの指定が優先、無ければグループ既定。条件が無効なら null。
 */
export function resolveRequiredGuildId(
  conditions: { requireDiscordGuild?: boolean; discordGuildId?: string } | null | undefined,
  groupDiscordGuildId: string | null | undefined,
): string | null {
  if (!conditions?.requireDiscordGuild) return null;
  return conditions.discordGuildId || groupDiscordGuildId || null;
}

/**
 * actor に紐づく Discord ユーザー ID を引く。
 * claim 済みの Fediverse アカウントからの申込でも本体アカウントの連携を使えるよう、
 * getApplicantInfo と同じ要領で同一人物の actor をたどる。
 */
export async function findDiscordUserId(db: Db, actorId: string): Promise<string | null> {
  const actor = await db.query.actors.findFirst({ where: eq(schema.actors.id, actorId) });
  if (!actor) return null;

  const identityIds = new Set([actorId]);
  const rootId = actor.claimedByActorId ?? (actor.state === 'local' ? actor.id : null);
  if (rootId) {
    identityIds.add(rootId);
    const aliases = await db.query.actors.findMany({
      where: eq(schema.actors.claimedByActorId, rootId),
    });
    for (const alias of aliases) identityIds.add(alias.id);
  }

  const row = await db.query.oauthAccounts.findFirst({
    where: and(
      eq(schema.oauthAccounts.provider, 'discord'),
      inArray(schema.oauthAccounts.userActorId, [...identityIds]),
    ),
  });
  return row?.providerUserId ?? null;
}

/**
 * Discord サーバーへの所属を確かめる。条件が有効なときだけ呼ぶこと。
 *
 * @param input.guildId resolveRequiredGuildId の結果。null は
 *   「条件は ON なのに対象サーバーが未設定」= 主催者の設定漏れなので拒否する
 * @param botToken 未設定なら判定できないので拒否する
 */
export async function checkDiscordGuildCondition(
  db: Db,
  input: { actorId: string; guildId: string | null },
  botToken: string | undefined,
): Promise<ConditionResult> {
  if (!input.guildId) {
    console.error('[discord] 参加条件が有効だが対象サーバー ID が未設定');
    return {
      ok: false,
      reason:
        'この枠は Discord サーバーの参加者のみが申し込めますが、対象サーバーが設定されていません。主催者にお問い合わせください。',
    };
  }

  if (!botToken) {
    console.error('[discord] DISCORD_BOT_TOKEN が未設定のため所属を確認できません');
    return {
      ok: false,
      reason:
        'Discord サーバーへの所属を確認できませんでした。時間をおいて試すか、主催者にお問い合わせください。',
    };
  }

  const discordUserId = await findDiscordUserId(db, input.actorId);
  if (!discordUserId) {
    return {
      ok: false,
      reason:
        'この枠は指定の Discord サーバーの参加者のみが申し込めます。設定 > 連携済みアカウント から Discord を連携してください。',
    };
  }

  const result = await checkDiscordGuildMember(botToken, input.guildId, discordUserId);
  if (result === 'member') return { ok: true };
  if (result === 'not_member') {
    return {
      ok: false,
      reason:
        'この枠は指定の Discord サーバーの参加者のみが申し込めます。サーバーに参加したうえで、もう一度お試しください。',
    };
  }
  return {
    ok: false,
    reason:
      'Discord サーバーへの所属を確認できませんでした。時間をおいて試すか、主催者にお問い合わせください。',
  };
}
