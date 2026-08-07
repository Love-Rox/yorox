/**
 * メールマジックリンク認証(実装順序: docs/OPEN-QUESTIONS.md #5 の第1弾)。
 *
 * フロー:
 * 1. request: email を受けてワンタイムトークンを発行し、リンクをメール送信
 * 2. verify: トークン検証(単回使用)
 *    - 既存ユーザー → セッション発行
 *    - 新規 → メール検証済みチケット(再発行トークン)を持たせて /onboarding へ
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { generateToken, hashToken } from '../lib/token';
import { ulid } from '../lib/ulid';
import type { NotificationDriver } from '../notifications/driver';

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15分
const SIGNUP_TICKET_TTL_MS = 30 * 60 * 1000; // オンボーディング入力の猶予 30分

export async function issueLoginToken(
  db: Db,
  email: string,
  ttlMs: number = LOGIN_TOKEN_TTL_MS,
  now: Date = new Date(),
): Promise<string> {
  const token = generateToken();
  await db.insert(schema.loginTokens).values({
    id: ulid(),
    tokenHash: await hashToken(token),
    email,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  });
  return token;
}

export async function requestMagicLink(
  db: Db,
  drivers: NotificationDriver[],
  input: { email: string; origin: string },
  now: Date = new Date(),
): Promise<void> {
  const token = await issueLoginToken(db, input.email, LOGIN_TOKEN_TTL_MS, now);
  const url = `${input.origin}/auth/magic-link/verify?token=${token}`;
  for (const driver of drivers) {
    try {
      await driver.send({
        actorId: '-',
        email: input.email,
        subject: '[Yorox] ログインリンク',
        bodyText: `以下のリンクからログインしてください(15分間有効):\n\n${url}\n\n心当たりがない場合はこのメールを無視してください。`,
        eventType: 'auth.magic_link',
      });
    } catch (err) {
      console.error(`[auth] magic link send failed (driver=${driver.name}):`, err);
    }
  }
}

/**
 * トークンを単回使用として消費し、メールアドレスを返す。無効なら null。
 */
export async function consumeLoginToken(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  const tokenHash = await hashToken(token);
  const row = await db.query.loginTokens.findFirst({
    where: and(
      eq(schema.loginTokens.tokenHash, tokenHash),
      isNull(schema.loginTokens.usedAt),
      gt(schema.loginTokens.expiresAt, now),
    ),
  });
  if (!row) return null;
  // usedAt を条件付き UPDATE で立て、変更行数 1 のときだけ有効(二重使用の競合を防ぐ)
  const result = await db
    .update(schema.loginTokens)
    .set({ usedAt: now })
    .where(and(eq(schema.loginTokens.id, row.id), isNull(schema.loginTokens.usedAt)));
  if ((result.meta?.changes ?? 0) !== 1) return null;
  return row.email;
}

/** 新規サインアップ用: メール検証済みチケットを発行する */
export async function issueSignupTicket(db: Db, email: string, now: Date = new Date()) {
  return issueLoginToken(db, email, SIGNUP_TICKET_TTL_MS, now);
}
