/**
 * D1 セッション管理(docs/OPEN-QUESTIONS.md #7)。
 * httpOnly cookie に平文トークン、DB に SHA-256 ハッシュ。行削除 = 即時失効。
 */
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { generateToken, hashToken } from '../lib/token';
import { ulid } from '../lib/ulid';

export const SESSION_COOKIE = 'yorox_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日

export async function createSession(
  db: Db,
  userActorId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(schema.authSessions).values({
    id: ulid(),
    tokenHash: await hashToken(token),
    userActorId,
    createdAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function getSessionUserActorId(
  db: Db,
  token: string | undefined,
  now: Date = new Date(),
): Promise<string | null> {
  if (!token) return null;
  const session = await db.query.authSessions.findFirst({
    where: and(
      eq(schema.authSessions.tokenHash, await hashToken(token)),
      gt(schema.authSessions.expiresAt, now),
    ),
  });
  return session?.userActorId ?? null;
}

export async function destroySession(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db
    .delete(schema.authSessions)
    .where(eq(schema.authSessions.tokenHash, await hashToken(token)));
}

/** 期限切れセッションの掃除(Cron から呼ぶ) */
export async function purgeExpiredSessions(db: Db, now: Date = new Date()): Promise<void> {
  await db.delete(schema.authSessions).where(lt(schema.authSessions.expiresAt, now));
  await db.delete(schema.loginTokens).where(lt(schema.loginTokens.expiresAt, now));
  await db.delete(schema.emailChangeTokens).where(lt(schema.emailChangeTokens.expiresAt, now));
}

export function sessionCookieHeader(token: string, expiresAt: Date, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearSessionCookieHeader(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
