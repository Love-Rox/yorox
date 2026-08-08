/**
 * メール送信キューとレート制御(docs/MAIL.md)。
 *
 * 通知メールは mail_queue に積み、Cron が古い順に「今送ってよい通数」だけ送る。
 * 上限は分・時の両方(AND)。失敗は指数バックオフで再試行し、上限到達で failed。
 */
import { and, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from '../lib/ulid';
import type { MailTransport } from './transport';

const MAX_ATTEMPTS = 5;

export interface RateLimits {
  perMinute: number;
  perHour: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { perMinute: 10, perHour: 100 };

/** 直近の送信実績から、今送ってよい通数を計算する(純粋関数) */
export function computeSendBudget(
  limits: RateLimits,
  sentLastMinute: number,
  sentLastHour: number,
): number {
  return Math.max(
    0,
    Math.min(limits.perMinute - sentLastMinute, limits.perHour - sentLastHour),
  );
}

/** 再試行のバックオフ(ミリ秒)。1分 → 2分 → 4分 → 8分… */
export function retryBackoffMs(attempts: number): number {
  return 60_000 * 2 ** Math.max(0, attempts - 1);
}

export async function enqueueMail(
  db: Db,
  message: { to: string; subject: string; bodyText: string },
  now: Date = new Date(),
): Promise<void> {
  await db.insert(schema.mailQueue).values({
    id: ulid(),
    toEmail: message.to,
    subject: message.subject,
    bodyText: message.bodyText,
    scheduledAt: now,
    createdAt: now,
  });
}

/**
 * キューを処理する。レート上限の範囲で古い順に送信。
 * @returns 送信した通数
 */
export async function processMailQueue(
  db: Db,
  transport: MailTransport,
  limits: RateLimits = DEFAULT_RATE_LIMITS,
  now: Date = new Date(),
): Promise<number> {
  const minuteAgo = new Date(now.getTime() - 60_000);
  const hourAgo = new Date(now.getTime() - 3_600_000);

  const [minuteRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mailQueue)
    .where(and(isNotNull(schema.mailQueue.sentAt), gt(schema.mailQueue.sentAt, minuteAgo)));
  const [hourRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mailQueue)
    .where(and(isNotNull(schema.mailQueue.sentAt), gt(schema.mailQueue.sentAt, hourAgo)));

  const budget = computeSendBudget(limits, minuteRow?.count ?? 0, hourRow?.count ?? 0);
  if (budget === 0) return 0;

  const pending = await db.query.mailQueue.findMany({
    where: and(
      eq(schema.mailQueue.status, 'pending'),
      lte(schema.mailQueue.scheduledAt, now),
    ),
    orderBy: [schema.mailQueue.scheduledAt],
    limit: budget,
  });

  const markSent = async (ids: { id: string; attempts: number }[]) => {
    for (const m of ids) {
      await db
        .update(schema.mailQueue)
        .set({ status: 'sent', sentAt: new Date(), attempts: m.attempts + 1 })
        .where(eq(schema.mailQueue.id, m.id));
    }
  };
  const markRetry = async (mail: { id: string; attempts: number }, err: unknown) => {
    const attempts = mail.attempts + 1;
    const failedPermanently = attempts >= MAX_ATTEMPTS;
    await db
      .update(schema.mailQueue)
      .set({
        status: failedPermanently ? 'failed' : 'pending',
        attempts,
        lastError: String(err).slice(0, 500),
        scheduledAt: new Date(now.getTime() + retryBackoffMs(attempts)),
      })
      .where(eq(schema.mailQueue.id, mail.id));
    console.error(
      `[mail] send failed (id=${mail.id}, attempts=${attempts}${failedPermanently ? ', giving up' : ''}):`,
      err,
    );
  };

  // まとめ送り対応トランスポート(Resend Batch API 等)は1回の呼び出しで送る
  if (transport.sendBatch && pending.length > 1) {
    try {
      await transport.sendBatch(
        pending.map((m) => ({ to: m.toEmail, subject: m.subject, bodyText: m.bodyText })),
      );
      await markSent(pending);
      return pending.length;
    } catch (err) {
      // 全件を再試行対象に(バッチは全成功 or 全失敗のセマンティクス)
      for (const mail of pending) await markRetry(mail, err);
      return 0;
    }
  }

  let sent = 0;
  for (const mail of pending) {
    try {
      await transport.send({
        to: mail.toEmail,
        subject: mail.subject,
        bodyText: mail.bodyText,
      });
      await markSent([mail]);
      sent++;
    } catch (err) {
      await markRetry(mail, err);
    }
  }
  return sent;
}
