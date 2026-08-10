/**
 * 個人アクセストークン(PAT)。MCP など API クライアントの Bearer 認証に使う。
 * 平文は発行時のみ返し、DB には SHA-256 ハッシュのみ保存する。
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { generateToken, hashToken } from '../lib/token';
import { ulid } from '../lib/ulid';

const PREFIX = 'yrx_';

/** トークンを発行する。返り値の token は発行時のみ表示できる平文 */
export async function createAccessToken(
  db: Db,
  userActorId: string,
  name: string,
  now: Date = new Date(),
): Promise<{ id: string; token: string }> {
  const token = PREFIX + generateToken();
  const id = ulid();
  await db.insert(schema.accessTokens).values({
    id,
    userActorId,
    tokenHash: await hashToken(token),
    name: name.trim() || 'アクセストークン',
    createdAt: now,
  });
  return { id, token };
}

export async function listAccessTokens(db: Db, userActorId: string) {
  return db.query.accessTokens.findMany({
    where: eq(schema.accessTokens.userActorId, userActorId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

export async function revokeAccessToken(
  db: Db,
  userActorId: string,
  id: string,
): Promise<void> {
  await db
    .delete(schema.accessTokens)
    .where(and(eq(schema.accessTokens.id, id), eq(schema.accessTokens.userActorId, userActorId)));
}

/**
 * Bearer トークンから本人の actorId を解決する。無効なら null。
 * 成功時は lastUsedAt を更新する(fire-and-forget)。
 */
export async function resolveActorByToken(
  db: Db,
  token: string | undefined,
  now: Date = new Date(),
): Promise<string | null> {
  if (!token || !token.startsWith(PREFIX)) return null;
  const row = await db.query.accessTokens.findFirst({
    where: eq(schema.accessTokens.tokenHash, await hashToken(token)),
  });
  if (!row) return null;
  await db
    .update(schema.accessTokens)
    .set({ lastUsedAt: now })
    .where(eq(schema.accessTokens.id, row.id))
    .catch(() => undefined);
  return row.userActorId;
}
