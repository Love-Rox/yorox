/**
 * グループの参加者ブロック。
 * 管理者がブロックしたアクターは、そのグループのイベントへ申込できない。
 * ブロックはローカル本人にもリモート別名にも効く(claim 関係を辿って判定)。
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';

export class GroupBlockedError extends Error {
  constructor(message = 'このグループのイベントには参加できません。') {
    super(message);
    this.name = 'GroupBlockedError';
  }
}

/**
 * actor がグループでブロックされているか。
 * 本人 actorId に加え、claim 済み別名なら紐付く本人 actorId も対象にする。
 */
export async function isActorBlocked(
  db: Db,
  groupActorId: string,
  actorId: string,
): Promise<boolean> {
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, actorId),
  });
  const candidateIds = [actorId];
  if (actor?.claimedByActorId) candidateIds.push(actor.claimedByActorId);

  const hit = await db
    .select({ blockedActorId: schema.groupBlocks.blockedActorId })
    .from(schema.groupBlocks)
    .where(
      and(
        eq(schema.groupBlocks.groupActorId, groupActorId),
        inArray(schema.groupBlocks.blockedActorId, candidateIds),
      ),
    )
    .limit(1);
  return hit.length > 0;
}

/** アクターをブロックする(既存なら理由を更新) */
export async function blockActor(
  db: Db,
  input: { groupActorId: string; blockedActorId: string; createdByActorId: string; reason?: string | undefined },
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(schema.groupBlocks)
    .values({
      groupActorId: input.groupActorId,
      blockedActorId: input.blockedActorId,
      reason: input.reason ?? null,
      createdByActorId: input.createdByActorId,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.groupBlocks.groupActorId, schema.groupBlocks.blockedActorId],
      set: { reason: input.reason ?? null, createdByActorId: input.createdByActorId, createdAt: now },
    });
}

/** ブロックを解除する */
export async function unblockActor(
  db: Db,
  groupActorId: string,
  blockedActorId: string,
): Promise<void> {
  await db
    .delete(schema.groupBlocks)
    .where(
      and(
        eq(schema.groupBlocks.groupActorId, groupActorId),
        eq(schema.groupBlocks.blockedActorId, blockedActorId),
      ),
    );
}

export interface BlockRow {
  blockedActorId: string;
  handle: string | null;
  domain: string | null;
  displayName: string;
  uri: string;
  reason: string | null;
  createdAt: Date;
}

/** グループのブロック一覧(表示用にアクター情報を結合) */
export async function listBlocks(db: Db, groupActorId: string): Promise<BlockRow[]> {
  const rows = await db
    .select({
      blockedActorId: schema.groupBlocks.blockedActorId,
      reason: schema.groupBlocks.reason,
      createdAt: schema.groupBlocks.createdAt,
      handle: schema.actors.handle,
      domain: schema.actors.domain,
      displayName: schema.actors.displayName,
      uri: schema.actors.uri,
    })
    .from(schema.groupBlocks)
    .innerJoin(schema.actors, eq(schema.groupBlocks.blockedActorId, schema.actors.id))
    .where(eq(schema.groupBlocks.groupActorId, groupActorId));
  return rows;
}
