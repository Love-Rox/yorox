/**
 * Cron Trigger で走る定期ジョブ(docs/DECISIONS.md「技術スタック」)。
 * - 抽選締切が来た枠の抽選実行
 * - 通知 outbox のディスパッチ
 */
import { and, eq, isNotNull, lte, ne, sql } from 'drizzle-orm';
import { createDb, schema } from '../db/client';
import { runLottery } from '../domain/participation';
import { dispatchPendingEvents } from '../notifications/dispatcher';
import { ConsoleDriver, ResendDriver, type NotificationDriver } from '../notifications/driver';

function buildDrivers(env: Env): NotificationDriver[] {
  const drivers: NotificationDriver[] = [new ConsoleDriver()];
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    drivers.push(new ResendDriver(env.RESEND_API_KEY, env.MAIL_FROM));
  }
  return drivers;
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

  const processed = await dispatchPendingEvents(db, buildDrivers(env));
  if (processed > 0) {
    console.log(`[scheduled] dispatched ${processed} domain event(s)`);
  }
}
