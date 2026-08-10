/**
 * メールアドレス変更(確認リンク方式)。
 *
 * フロー:
 * 1. request: 新アドレス宛に確認リンクを送る(旧アドレスにも申請があった旨を通知)
 * 2. confirm: リンクのトークンを検証(単回使用)して users.email を書き換える
 *
 * 変更を即時適用しないのは、打ち間違い・他人のアドレスの入力を弾くため。
 * 確認が済むまでは旧アドレスでのログインがそのまま使える。
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { generateToken, hashToken } from '../lib/token';
import { ulid } from '../lib/ulid';
import type { MailMessage } from '../mail/transport';

const EMAIL_CHANGE_TOKEN_TTL_MS = 30 * 60 * 1000; // 30分

/** ざっくりしたメール形式チェック(厳密な検証は確認リンクの到達が兼ねる) */
export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

export type RequestEmailChangeResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'taken' | 'same' };

/**
 * 変更を申請し、新アドレスへ確認リンクを送る。
 * 既に他のアカウントが使っているアドレスは断る(unique 制約を確認時まで遅らせない)。
 */
export async function requestEmailChange(
  db: Db,
  sendMail: (message: MailMessage) => Promise<void>,
  input: { actorId: string; newEmail: string; origin: string },
  now: Date = new Date(),
): Promise<RequestEmailChangeResult> {
  const newEmail = input.newEmail.trim().toLowerCase();
  if (!looksLikeEmail(newEmail)) return { ok: false, reason: 'invalid' };

  const me = await db.query.users.findFirst({
    where: eq(schema.users.actorId, input.actorId),
  });
  if (!me) return { ok: false, reason: 'invalid' };
  if (me.email.toLowerCase() === newEmail) return { ok: false, reason: 'same' };

  const taken = await db.query.users.findFirst({
    where: eq(schema.users.email, newEmail),
  });
  if (taken) return { ok: false, reason: 'taken' };

  const token = generateToken();
  await db.insert(schema.emailChangeTokens).values({
    id: ulid(),
    tokenHash: await hashToken(token),
    userActorId: input.actorId,
    newEmail,
    createdAt: now,
    expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TOKEN_TTL_MS),
  });

  const url = `${input.origin}/profile/email/confirm?token=${token}`;
  try {
    await sendMail({
      to: newEmail,
      subject: '[Yorox] メールアドレス変更の確認',
      bodyText: `Yorox のログイン用メールアドレスをこのアドレスへ変更する申請がありました。\n変更する場合は以下のリンクを開いてください(30分間有効):\n\n${url}\n\n心当たりがない場合はこのメールを無視してください(変更は行われません)。`,
    });
    // 旧アドレスにも申請があったことを知らせる(乗っ取り時に気づけるように)
    await sendMail({
      to: me.email,
      subject: '[Yorox] メールアドレス変更の申請がありました',
      bodyText: `お使いの Yorox アカウントで、ログイン用メールアドレスの変更が申請されました。\n新しいアドレス宛の確認リンクが開かれるまで変更は適用されません。\n\n心当たりがない場合は、パスキーの登録状況と連携アカウントをご確認ください。`,
    });
  } catch (err) {
    console.error('[auth] email change mail send failed:', err);
  }
  return { ok: true };
}

/**
 * 確認トークンを消費して変更を適用する。
 * @returns 適用後のメールアドレス。無効・期限切れ・使用済み・衝突なら null
 */
export async function confirmEmailChange(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  const tokenHash = await hashToken(token);
  const row = await db.query.emailChangeTokens.findFirst({
    where: and(
      eq(schema.emailChangeTokens.tokenHash, tokenHash),
      isNull(schema.emailChangeTokens.usedAt),
      gt(schema.emailChangeTokens.expiresAt, now),
    ),
  });
  if (!row) return null;

  // usedAt を条件付き UPDATE で立て、変更行数 1 のときだけ有効(二重使用の競合を防ぐ)
  const used = await db
    .update(schema.emailChangeTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.emailChangeTokens.id, row.id),
        isNull(schema.emailChangeTokens.usedAt),
      ),
    );
  if ((used.meta?.changes ?? 0) !== 1) return null;

  // 申請から確認までの間に他人が同じアドレスで登録した可能性を再確認する
  const taken = await db.query.users.findFirst({
    where: eq(schema.users.email, row.newEmail),
  });
  if (taken) return null;

  await db
    .update(schema.users)
    .set({ email: row.newEmail, emailVerifiedAt: now })
    .where(eq(schema.users.actorId, row.userActorId));
  return row.newEmail;
}
