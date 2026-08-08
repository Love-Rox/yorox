/**
 * AP 配信の fan-out とキュー処理。
 *
 * - イベント公開時: フォロワーの inbox を集めて ap_deliveries に積む
 * - cron: 期限が来た未送信行を署名付きで配信(バックオフ付きリトライ)
 *
 * タイムライン表示互換のため告知は Note で配信する(docs/DECISIONS.md)。
 * Note / Create の URI は決定論的(/events/{id}/note, /events/{id}/activity)で、
 * outbox の動的生成と同じ ID になる。
 */
import { activities, buildEventNote, type ApActivity } from '@yorox/ap';
import { and, asc, eq, isNull, lt, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ensureActorKeys } from '../lib/actor-keys';
import { deliverActivity } from '../lib/deliver';
import { ulid } from '../lib/ulid';
import { retryBackoffMs } from '../mail/queue';

const MAX_ATTEMPTS = 5;

const NOTE_DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
});

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** イベント告知 Note の本文 HTML(タイトル・日時・会場・リンク) */
export function buildAnnouncementHtml(event: {
  title: string;
  startsAt: Date;
  venueName: string | null;
  humanUrl: string;
}): string {
  const lines = [
    `<p><strong>${escapeHtml(event.title)}</strong></p>`,
    `<p>📅 ${escapeHtml(NOTE_DATE_FMT.format(event.startsAt))}</p>`,
  ];
  if (event.venueName) lines.push(`<p>📍 ${escapeHtml(event.venueName)}</p>`);
  lines.push(
    `<p><a href="${escapeHtml(event.humanUrl)}" rel="noreferrer">${escapeHtml(event.humanUrl)}</a></p>`,
  );
  return lines.join('');
}

/** イベントの Create(Note) アクティビティを組み立てる(outbox と fan-out で共用) */
export function buildEventAnnouncement(
  group: { id: string; uri: string; handle: string | null },
  event: {
    id: string;
    title: string;
    startsAt: Date;
    venueName: string | null;
    publishedAt: Date | null;
  },
): ApActivity {
  const origin = new URL(group.uri).origin;
  const eventUri = `${origin}/events/${event.id}`;
  const humanUrl = group.handle
    ? `${origin}/g/${group.handle}/events/${event.id}`
    : eventUri;
  const note = buildEventNote({
    uri: `${eventUri}/note`,
    attributedTo: group.uri,
    contentHtml: buildAnnouncementHtml({ ...event, humanUrl }),
    url: humanUrl,
    followersUri: `${group.uri}/followers`,
    published: (event.publishedAt ?? new Date()).toISOString(),
  });
  return activities.create(group.uri, note, {
    id: `${eventUri}/activity`,
    to: 'https://www.w3.org/ns/activitystreams#Public',
    cc: `${group.uri}/followers`,
    published: note.published as string,
  });
}

/**
 * 公開イベントの告知をフォロワー全員分キューに積む。
 * inbox は sharedInbox 優先で重複排除する。フォロワー 0 なら何もしない。
 */
export async function enqueueEventAnnouncement(db: Db, eventId: string): Promise<number> {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
  });
  if (!event || event.visibility !== 'public') return 0;
  const group = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  if (!group) return 0;

  const followers = await db
    .select({
      inboxUrl: schema.actors.inboxUrl,
      sharedInboxUrl: schema.actors.sharedInboxUrl,
    })
    .from(schema.follows)
    .innerJoin(schema.actors, eq(schema.follows.followerActorId, schema.actors.id))
    .where(eq(schema.follows.followedActorId, group.id));

  const inboxes = new Set<string>();
  for (const f of followers) {
    const inbox = f.sharedInboxUrl ?? f.inboxUrl;
    if (inbox) inboxes.add(inbox);
  }
  if (inboxes.size === 0) return 0;

  const activity = buildEventAnnouncement(group, event);
  const now = new Date();
  await db.insert(schema.apDeliveries).values(
    [...inboxes].map((inboxUrl) => ({
      id: ulid(),
      signerActorId: group.id,
      inboxUrl,
      activityJson: activity as unknown as Record<string, unknown>,
      nextAttemptAt: now,
      createdAt: now,
    })),
  );
  return inboxes.size;
}

/**
 * 配信キューを処理する。成功で sentAt、失敗はバックオフ付きで再試行し、
 * MAX_ATTEMPTS 到達で打ち切り(行は lastError と共に残す)。
 * @returns 配信に成功した件数
 */
export async function processApDeliveries(
  db: Db,
  now: Date = new Date(),
  limit = 20,
): Promise<number> {
  const pending = await db.query.apDeliveries.findMany({
    where: and(
      isNull(schema.apDeliveries.sentAt),
      lt(schema.apDeliveries.attempts, MAX_ATTEMPTS),
      lte(schema.apDeliveries.nextAttemptAt, now),
    ),
    orderBy: [asc(schema.apDeliveries.createdAt)],
    limit,
  });

  let sent = 0;
  const keysCache = new Map<string, string>();
  for (const row of pending) {
    let privateKeyPem = keysCache.get(row.signerActorId);
    let actorUri: string | undefined;
    const signer = await db.query.actors.findFirst({
      where: eq(schema.actors.id, row.signerActorId),
    });
    if (!signer) continue;
    actorUri = signer.uri;
    if (!privateKeyPem) {
      privateKeyPem = (await ensureActorKeys(db, row.signerActorId)).privateKeyPem;
      keysCache.set(row.signerActorId, privateKeyPem);
    }

    const ok = await deliverActivity({
      activity: row.activityJson as unknown as ApActivity,
      inboxUrl: row.inboxUrl,
      actorUri,
      privateKeyPem,
    });
    if (ok) {
      await db
        .update(schema.apDeliveries)
        .set({ sentAt: new Date(), attempts: row.attempts + 1 })
        .where(eq(schema.apDeliveries.id, row.id));
      sent++;
    } else {
      const attempts = row.attempts + 1;
      await db
        .update(schema.apDeliveries)
        .set({
          attempts,
          lastError: `delivery failed (attempt ${attempts})`,
          nextAttemptAt: new Date(now.getTime() + retryBackoffMs(attempts)),
        })
        .where(eq(schema.apDeliveries.id, row.id));
      if (attempts >= MAX_ATTEMPTS) {
        console.warn(`[ap] delivery gave up: ${row.inboxUrl} (id=${row.id})`);
      }
    }
  }
  return sent;
}
