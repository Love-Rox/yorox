/**
 * ドメインイベント → 通知のディスパッチャ。
 * domain_events の未処理分を拾い、宛先を解決してドライバ群へ配る。
 * Cron Trigger やリクエスト後の waitUntil から呼ぶ想定。
 */
import { asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { buildNotificationBody, type NotificationContext } from './body';
import type { Notification, NotificationDriver } from './driver';

/**
 * 枠 ID からイベントの詳細を引く(本文に載せる用)。
 * 解決できなければ null(テンプレートの一文だけで送る)。
 */
async function loadEventContext(
  db: Db,
  slotId: string,
  origin: string,
): Promise<NotificationContext | null> {
  const slot = await db.query.slots.findFirst({ where: eq(schema.slots.id, slotId) });
  if (!slot) return null;
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, slot.eventId) });
  if (!event) return null;
  return {
    eventTitle: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    venue: event.venueName ?? (event.onlineUrl ? 'オンライン開催' : null),
    slotName: slot.name,
    // 短縮 URL は正規 URL へ 301 するので、handle を引かずに済む
    url: `${origin.replace(/\/$/, '')}/e/${event.id}`,
  };
}

/** ドメインイベント種別ごとの文面テンプレート */
const TEMPLATES: Record<
  string,
  { subject: string; body: string } | undefined
> = {
  'participation.accepted': {
    subject: '参加が確定しました',
    body: 'イベントへの参加が確定しました。詳細はイベントページをご確認ください。',
  },
  'participation.waitlisted': {
    subject: '補欠として受け付けました',
    body: '定員に達していたため補欠として受け付けました。繰上がり次第お知らせします。',
  },
  'participation.applied': {
    subject: '抽選の申込を受け付けました',
    body: '抽選結果が確定しましたらお知らせします。',
  },
  'participation.rejected': {
    subject: '参加いただけませんでした',
    body: '抽選の結果、今回はご参加いただけませんでした。',
  },
  'participation.promoted': {
    subject: '補欠から繰り上がりました',
    body: '空きが出たため参加が確定しました。詳細はイベントページをご確認ください。',
  },
  'participation.payment_pending': {
    subject: '参加受付 — お支払いのご案内',
    body: '参加を受け付けました。お支払いの確認をもって参加確定となります。詳細はイベントページをご確認ください。',
  },
  'participation.reminder': {
    subject: 'まもなく開催です',
    body: 'ご参加予定のイベントがまもなく開催されます。日時・会場をご確認ください。詳細はイベントページをご覧ください。',
  },
  'payment.paid': {
    subject: 'お支払いを確認しました',
    body: 'お支払いを確認しました。ありがとうございます。',
  },
  'event.cancelled': {
    subject: 'イベントが中止になりました',
    body: 'お申し込みいただいたイベントが主催者により中止されました。詳細はイベントページをご確認ください。お支払い済みの場合の返金は主催者にお問い合わせください。',
  },
  'participation.consent_requested': {
    subject: '【要確認】繰上参加の承諾のお願い',
    body: '空きが出ました。参加するにはイベントページから承諾してください。承諾がない場合、次の方に繰り上がります。',
  },
};

/** 通知以外の副作用(AP 配信の fan-out 等)。失敗するとイベントは未処理のまま次回再試行 */
export type DomainEventHook = (
  db: Db,
  event: { id: string; type: string; payload: unknown },
) => Promise<void>;

/**
 * 未処理のドメインイベントを最大 limit 件処理する。
 * 個別ドライバの失敗は他のドライバ・他のイベントの処理を止めない。
 */
export async function dispatchPendingEvents(
  db: Db,
  drivers: NotificationDriver[],
  limit = 50,
  hooks: Record<string, DomainEventHook | undefined> = {},
  origin = '',
): Promise<number> {
  const pending = await db.query.domainEvents.findMany({
    where: isNull(schema.domainEvents.processedAt),
    orderBy: [asc(schema.domainEvents.createdAt)],
    limit,
  });

  let processed = 0;
  for (const event of pending) {
    const hook = hooks[event.type];
    if (hook) {
      try {
        await hook(db, event);
      } catch (err) {
        // フック失敗はイベントを未処理のまま残し、次回の cron で再試行する
        console.error(`[dispatcher] hook event=${event.id} type=${event.type} failed:`, err);
        continue;
      }
    }
    const template = TEMPLATES[event.type];
    if (template) {
      const payload = event.payload as { actorId?: string; slotId?: string };
      const actorId = payload.actorId;
      if (actorId) {
        const user = await db.query.users.findFirst({
          where: eq(schema.users.actorId, actorId),
        });
        // 「どのイベントの話か」が分かるよう、本文にイベント情報を添える
        const ctx =
          origin && payload.slotId ? await loadEventContext(db, payload.slotId, origin) : null;
        const notification: Notification = {
          actorId,
          subject: ctx ? `[Yorox] ${template.subject} — ${ctx.eventTitle}` : `[Yorox] ${template.subject}`,
          bodyText: buildNotificationBody(template.body, ctx),
          eventType: event.type,
        };
        // メール通知をオフにしているユーザーには email を渡さない(AP 通知等は届く)
        if (user?.email !== undefined && user.emailNotifications) {
          notification.email = user.email;
        }
        if (payload.slotId !== undefined) notification.slotId = payload.slotId;
        for (const driver of drivers) {
          try {
            await driver.send(notification);
          } catch (err) {
            // ドライバ単位の失敗はログに残して継続(配達保証が必要なものは action_requests で担保)
            console.error(`[dispatcher] driver=${driver.name} event=${event.id} failed:`, err);
          }
        }
      }
    }
    await db
      .update(schema.domainEvents)
      .set({ processedAt: new Date() })
      .where(eq(schema.domainEvents.id, event.id));
    processed++;
  }
  return processed;
}
