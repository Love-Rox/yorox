/**
 * Cron Trigger で走る定期ジョブ(docs/DECISIONS.md「技術スタック」)。
 * - 抽選締切が来た枠の抽選実行
 * - 通知 outbox のディスパッチ
 */
import { and, eq, isNotNull, lte, ne, sql } from 'drizzle-orm';
import { purgeExpiredSessions } from '../auth/session';
import { createDb, schema, type Db } from '../db/client';
import { runLottery } from '../domain/participation';
import { DEFAULT_RATE_LIMITS, processMailQueue, type RateLimits } from '../mail/queue';
import { createTransportFromEnv } from '../mail/transport';
import { dispatchPendingEvents } from '../notifications/dispatcher';
import { ConsoleDriver, QueueEmailDriver, type NotificationDriver } from '../notifications/driver';

function buildDrivers(env: Env, db: Db): NotificationDriver[] {
  const drivers: NotificationDriver[] = [new ConsoleDriver()];
  // トランスポートが設定されているときだけキューへ積む(未設定で溜め続けない)
  if (createTransportFromEnv(env)) {
    drivers.push(new QueueEmailDriver(db));
  }
  return drivers;
}

function rateLimitsFromEnv(env: Env): RateLimits {
  const perMinute = Number.parseInt(env.MAIL_RATE_PER_MINUTE ?? '', 10);
  const perHour = Number.parseInt(env.MAIL_RATE_PER_HOUR ?? '', 10);
  return {
    perMinute: Number.isNaN(perMinute) ? DEFAULT_RATE_LIMITS.perMinute : perMinute,
    perHour: Number.isNaN(perHour) ? DEFAULT_RATE_LIMITS.perHour : perHour,
  };
}

export async function runScheduledJobs(env: Env, now: Date = new Date()): Promise<void> {
  const db = createDb(env.DB);

  // 締切が来ていて、まだ applied が残っている抽選枠を探して抽選を実行
  const dueSlots = await db
    .select({ id: schema.slots.id })
    .from(schema.slots)
    .where(
      and(
        eq(schema.slots.method, 'lottery'),
        ne(schema.slots.lotteryLogic, 'manual'),
        isNotNull(schema.slots.lotteryAt),
        lte(schema.slots.lotteryAt, now),
        sql`EXISTS (
          SELECT 1 FROM participations
          WHERE participations.slot_id = ${schema.slots.id}
            AND participations.status = 'applied'
        )`,
      ),
    );

  for (const slot of dueSlots) {
    try {
      const result = await runLottery(db, slot.id, now);
      console.log(`[scheduled] lottery slot=${slot.id}`, result);
    } catch (err) {
      console.error(`[scheduled] lottery slot=${slot.id} failed:`, err);
    }
  }

  const processed = await dispatchPendingEvents(db, buildDrivers(env, db));
  if (processed > 0) {
    console.log(`[scheduled] dispatched ${processed} domain event(s)`);
  }

  // メール送信キューの処理(レート制御付き)
  const transport = createTransportFromEnv(env);
  if (transport) {
    const sent = await processMailQueue(db, transport, rateLimitsFromEnv(env), now);
    if (sent > 0) {
      console.log(`[scheduled] sent ${sent} queued mail(s) via ${transport.name}`);
    }
  }

  // 期限切れセッション・トークンの掃除
  await purgeExpiredSessions(db, now);
}
