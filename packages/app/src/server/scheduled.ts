/**
 * Cron Trigger で走る定期ジョブ(docs/DECISIONS.md「技術スタック」)。
 * - 抽選締切が来た枠の抽選実行
 * - 通知 outbox のディスパッチ
 */
import { and, eq, gte, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import { purgeExpiredSessions } from '../auth/session';
import { createDb, schema, type Db } from '../db/client';
import { publishEvent } from '../domain/event-service';
import { emitDomainEvent } from '../domain/events';
import { notifyLocalFollowersOfPublish } from '../domain/follow';
import { buildJoinDeps } from './join-deps';
import { runLottery } from '../domain/participation';
import { DEFAULT_RATE_LIMITS, processMailQueue, type RateLimits } from '../mail/queue';
import { createTransportFromEnv } from '../mail/transport';
import { ApNoteDriver } from '../notifications/ap-driver';
import { DiscordDmDriver } from '../notifications/discord-driver';
import { dispatchPendingEvents } from '../notifications/dispatcher';
import { ConsoleDriver, QueueEmailDriver, type NotificationDriver } from '../notifications/driver';
import {
  announceEventNow,
  enqueueEventAnnouncement,
  processApDeliveries,
} from './ap-delivery';

function buildDrivers(env: Env, db: Db): NotificationDriver[] {
  const drivers: NotificationDriver[] = [new ConsoleDriver()];
  // トランスポートが設定されているときだけキューへ積む(未設定で溜め続けない)
  if (createTransportFromEnv(env)) {
    drivers.push(new QueueEmailDriver(db));
  }
  // リモート参加者(Fediverse エイリアス)にはダイレクト Note で通知
  drivers.push(new ApNoteDriver(db));
  // Discord: Bot DM(トークン設定時)と個人 Webhook(本人設定時)
  drivers.push(new DiscordDmDriver(db, env.DISCORD_BOT_TOKEN));
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
      const result = await runLottery(db, slot.id, now, await buildJoinDeps());
      console.log(`[scheduled] lottery slot=${slot.id}`, result);
    } catch (err) {
      console.error(`[scheduled] lottery slot=${slot.id} failed:`, err);
    }
  }

  // 予約公開: 時刻を過ぎた下書きを公開し、AP 告知 + Bluesky クロスポストまで行う
  const duePublishes = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.visibility, 'draft'),
        // 中止したイベントは予約時刻が来ても公開しない
        isNull(schema.events.cancelledAt),
        isNotNull(schema.events.publishAt),
        lte(schema.events.publishAt, now),
      ),
    );
  for (const event of duePublishes) {
    try {
      await publishEvent(db, event.id, now);
      await announceEventNow(db, event.id);
      console.log(`[scheduled] published event ${event.id} (予約公開)`);
    } catch (err) {
      console.error(`[scheduled] scheduled publish failed (event=${event.id}):`, err);
    }
  }

  // 開催前リマインダー: 24時間以内に始まる公開イベントの参加確定者へ一度だけ通知
  const reminderWindowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dueReminders = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.visibility, 'public'),
        // 中止したイベントにはリマインダーを送らない
        isNull(schema.events.cancelledAt),
        isNull(schema.events.reminderSentAt),
        gte(schema.events.startsAt, now),
        lte(schema.events.startsAt, reminderWindowEnd),
      ),
    );
  for (const event of dueReminders) {
    try {
      const attendees = await db
        .select({
          participationId: schema.participations.id,
          slotId: schema.participations.slotId,
          actorId: schema.participations.actorId,
        })
        .from(schema.participations)
        .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
        .where(
          and(
            eq(schema.slots.eventId, event.id),
            eq(schema.participations.status, 'accepted'),
          ),
        );
      for (const a of attendees) {
        await emitDomainEvent(db, 'participation.reminder', a, now);
      }
      await db
        .update(schema.events)
        .set({ reminderSentAt: now })
        .where(eq(schema.events.id, event.id));
      if (attendees.length > 0) {
        console.log(`[scheduled] reminders queued for ${event.id}: ${attendees.length}`);
      }
    } catch (err) {
      console.error(`[scheduled] reminder failed (event=${event.id}):`, err);
    }
  }

  const processed = await dispatchPendingEvents(db, buildDrivers(env, db), 50, {
    // イベント公開 → フォロワーへの AP 告知を配信キューに積む
    'event.published': async (hookDb, event) => {
      const eventId = (event.payload as { eventId?: string }).eventId;
      if (!eventId) return;
      const queued = await enqueueEventAnnouncement(hookDb, eventId);
      if (queued > 0) console.log(`[scheduled] queued ${queued} AP delivery(ies) for ${eventId}`);
      const notified = await notifyLocalFollowersOfPublish(hookDb, eventId);
      if (notified > 0) console.log(`[scheduled] queued ${notified} follower notification(s) for ${eventId}`);
    },
  },
  // 通知本文にイベント名・日時・URL を載せるために origin が要る
  env.PUBLIC_ORIGIN ?? '',
  );
  if (processed > 0) {
    console.log(`[scheduled] dispatched ${processed} domain event(s)`);
  }

  // AP 配信キューの処理(署名付き server-to-server 配信)。
  // 直前の dispatch で積まれた分も同一パスで拾えるよう現在時刻で判定する
  const delivered = await processApDeliveries(db, new Date());
  if (delivered > 0) {
    console.log(`[scheduled] delivered ${delivered} AP activity(ies)`);
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
