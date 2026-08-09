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
import { activities, buildEventNote, type ApActivity, type ApObject } from '@yorox/ap';
import { escapeHtml } from '../lib/html';
import { and, asc, eq, isNull, lt, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ensureActorKeys } from '../lib/actor-keys';
import {
  buildBskyAnnouncementText,
  createBskySession,
  postToBluesky,
} from '../lib/bluesky';
import { deliverActivity } from '../lib/deliver';
import { ulid } from '../lib/ulid';
import { retryBackoffMs } from '../mail/queue';

const MAX_ATTEMPTS = 5;

const NOTE_DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
});

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

/** フォロワーの inbox 一覧(sharedInbox 優先で重複排除) */
async function collectFollowerInboxes(db: Db, groupActorId: string): Promise<Set<string>> {
  const followers = await db
    .select({
      inboxUrl: schema.actors.inboxUrl,
      sharedInboxUrl: schema.actors.sharedInboxUrl,
    })
    .from(schema.follows)
    .innerJoin(schema.actors, eq(schema.follows.followerActorId, schema.actors.id))
    .where(eq(schema.follows.followedActorId, groupActorId));
  const inboxes = new Set<string>();
  for (const f of followers) {
    const inbox = f.sharedInboxUrl ?? f.inboxUrl;
    if (inbox) inboxes.add(inbox);
  }
  return inboxes;
}

/**
 * 公開イベントの告知をフォロワー全員分キューに積む。
 * フォロワー 0 なら何もしない。
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

  const inboxes = await collectFollowerInboxes(db, group.id);
  if (inboxes.size === 0) return 0;

  const activity = buildEventAnnouncement(group, event);
  const now = new Date();
  // (activityUri, inboxUrl) 一意制約で冪等: 即時配信と cron が重なっても二重に積まれない
  await db
    .insert(schema.apDeliveries)
    .values(
      [...inboxes].map((inboxUrl) => ({
        id: ulid(),
        signerActorId: group.id,
        inboxUrl,
        activityUri: activity.id as string,
        activityJson: activity as unknown as Record<string, unknown>,
        nextAttemptAt: now,
        createdAt: now,
      })),
    )
    .onConflictDoNothing();
  return inboxes.size;
}

/**
 * 単一 inbox への即時配信。成功すればそれで終わり、失敗したときだけ
 * キューに積んで cron のバックオフ再試行に委ねる。
 * inbox 応答(Accept 返送・参加結果通知など)のリアルタイム経路。
 */
export async function deliverWithRetry(
  db: Db,
  input: { signerActorId: string; inboxUrl: string; activity: ApActivity },
): Promise<boolean> {
  const signer = await db.query.actors.findFirst({
    where: eq(schema.actors.id, input.signerActorId),
  });
  if (!signer) return false;
  const keys = await ensureActorKeys(db, input.signerActorId);
  const ok = await deliverActivity({
    activity: input.activity,
    inboxUrl: input.inboxUrl,
    actorUri: signer.uri,
    privateKeyPem: keys.privateKeyPem,
  });
  if (!ok) {
    const now = new Date();
    await db
      .insert(schema.apDeliveries)
      .values({
        id: ulid(),
        signerActorId: input.signerActorId,
        inboxUrl: input.inboxUrl,
        activityUri: (input.activity.id as string) ?? null,
        activityJson: input.activity as unknown as Record<string, unknown>,
        attempts: 1,
        lastError: 'immediate delivery failed',
        nextAttemptAt: new Date(now.getTime() + retryBackoffMs(1)),
        createdAt: now,
      })
      .onConflictDoNothing();
  }
  return ok;
}


/** グループ投稿の Note(タイムライン投稿の連合表現) */
export function buildGroupPostNote(
  group: { id: string; uri: string },
  post: { id: string; bodyHtml: string; createdAt: Date },
): ApObject {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${group.uri}/posts/${post.id}`,
    type: 'Note',
    attributedTo: group.uri,
    content: post.bodyHtml,
    mediaType: 'text/html',
    published: post.createdAt.toISOString(),
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [`${group.uri}/followers`],
  };
}

/** グループ投稿をフォロワーへ配信し、Bluesky にもクロスポストする */
export async function announceGroupPostNow(
  db: Db,
  groupActorId: string,
  post: { id: string; bodyHtml: string; bodyText: string; createdAt: Date },
): Promise<void> {
  const group = await db.query.actors.findFirst({
    where: eq(schema.actors.id, groupActorId),
  });
  if (!group?.handle) return;
  try {
    const note = buildGroupPostNote(group, post);
    const create = activities.create(group.uri, note, {
      id: `${note.id}/activity`,
      to: 'https://www.w3.org/ns/activitystreams#Public',
      cc: `${group.uri}/followers`,
      published: note.published as string,
    });
    const inboxes = await collectFollowerInboxes(db, group.id);
    if (inboxes.size > 0) {
      const now = new Date();
      await db
        .insert(schema.apDeliveries)
        .values(
          [...inboxes].map((inboxUrl) => ({
            id: ulid(),
            signerActorId: group.id,
            inboxUrl,
            activityUri: create.id as string,
            activityJson: create as unknown as Record<string, unknown>,
            nextAttemptAt: now,
            createdAt: now,
          })),
        )
        .onConflictDoNothing();
      await processApDeliveries(db, new Date(), Math.max(inboxes.size, 10));
    }
  } catch (err) {
    console.error(`[ap] group post announce failed (post=${post.id}):`, err);
  }
  // Bluesky クロスポスト(連携済みグループのみ)
  try {
    const settings = await db.query.groups.findFirst({
      where: eq(schema.groups.actorId, group.id),
    });
    if (settings?.bskyIdentifier && settings.bskyAppPassword) {
      const session = await createBskySession(settings.bskyIdentifier, settings.bskyAppPassword);
      if (session) {
        const origin = new URL(group.uri).origin;
        const groupUrl = `${origin}/g/${group.handle}`;
        const budget = 300 - [...`\n${groupUrl}`].length;
        const text =
          [...post.bodyText].length > budget
            ? [...post.bodyText].slice(0, Math.max(0, budget - 1)).join('') + '…'
            : post.bodyText;
        await postToBluesky(session, `${text}\n${groupUrl}`, groupUrl);
      }
    }
  } catch (err) {
    console.error(`[bsky] group post crosspost failed (post=${post.id}):`, err);
  }
}

/** グループ投稿の削除をフォロワーへ配信する(Tombstone 化) */
export async function announceGroupPostDeleteNow(
  db: Db,
  group: { id: string; uri: string },
  postId: string,
): Promise<void> {
  try {
    const noteUri = `${group.uri}/posts/${postId}`;
    const del = activities.deleteActivity(group.uri, noteUri, {
      id: `${noteUri}/delete/${ulid()}`,
      to: 'https://www.w3.org/ns/activitystreams#Public',
      cc: `${group.uri}/followers`,
    });
    const inboxes = await collectFollowerInboxes(db, group.id);
    if (inboxes.size === 0) return;
    const now = new Date();
    await db
      .insert(schema.apDeliveries)
      .values(
        [...inboxes].map((inboxUrl) => ({
          id: ulid(),
          signerActorId: group.id,
          inboxUrl,
          activityUri: del.id as string,
          activityJson: del as unknown as Record<string, unknown>,
          nextAttemptAt: now,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
    await processApDeliveries(db, new Date(), Math.max(inboxes.size, 10));
  } catch (err) {
    console.error(`[ap] group post delete announce failed (post=${postId}):`, err);
  }
}

/**
 * 公開イベントの編集をフォロワーへ Update(Note) で配信する。
 * Note の URI は不変(/events/{id}/note)なので、受信側は同じ投稿を更新する。
 * リクエストの waitUntil から呼ぶ想定。
 */
export async function announceEventUpdateNow(db: Db, eventId: string): Promise<void> {
  try {
    const event = await db.query.events.findFirst({
      where: eq(schema.events.id, eventId),
    });
    if (!event || event.visibility !== 'public') return;
    const group = await db.query.actors.findFirst({
      where: eq(schema.actors.id, event.groupActorId),
    });
    if (!group) return;
    const inboxes = await collectFollowerInboxes(db, group.id);
    if (inboxes.size === 0) return;

    const create = buildEventAnnouncement(group, event);
    const origin = new URL(group.uri).origin;
    const update = activities.update(group.uri, create.object as ApObject, {
      id: `${origin}/events/${event.id}/activity/update/${ulid()}`,
      to: 'https://www.w3.org/ns/activitystreams#Public',
      cc: `${group.uri}/followers`,
      published: new Date().toISOString(),
    });
    const now = new Date();
    await db
      .insert(schema.apDeliveries)
      .values(
        [...inboxes].map((inboxUrl) => ({
          id: ulid(),
          signerActorId: group.id,
          inboxUrl,
          activityUri: update.id as string,
          activityJson: update as unknown as Record<string, unknown>,
          nextAttemptAt: now,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
    const sent = await processApDeliveries(db, new Date(), Math.max(inboxes.size, 10));
    console.log(`[ap] update announce: inboxes=${inboxes.size} sent=${sent} event=${eventId}`);
  } catch (err) {
    console.error(`[ap] update announce failed (event=${eventId}):`, err);
  }
}

/**
 * 公開直後の即時配信。fan-out してすぐキューを処理する。
 * リクエストの waitUntil から呼ぶ想定。失敗分は cron が拾い直す。
 */
export async function announceEventNow(db: Db, eventId: string): Promise<void> {
  try {
    const queued = await enqueueEventAnnouncement(db, eventId);
    if (queued > 0) {
      const sent = await processApDeliveries(db, new Date(), Math.max(queued, 10));
      console.log(`[ap] immediate announce: queued=${queued} sent=${sent} event=${eventId}`);
    }
  } catch (err) {
    // 即時配信の失敗は cron のリトライに任せる
    console.error(`[ap] immediate announce failed (event=${eventId}):`, err);
  }
  // Bluesky クロスポスト(連携済みグループのみ。非冪等なので即時経路のみで行う)
  try {
    await crosspostEventToBluesky(db, eventId);
  } catch (err) {
    console.error(`[bsky] crosspost failed (event=${eventId}):`, err);
  }
}

/** グループが Bluesky 連携済みなら公開イベントの告知を投稿する */
async function crosspostEventToBluesky(db: Db, eventId: string): Promise<void> {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
  });
  if (!event || event.visibility !== 'public') return;
  const group = await db.query.groups.findFirst({
    where: eq(schema.groups.actorId, event.groupActorId),
  });
  if (!group?.bskyIdentifier || !group.bskyAppPassword) return;
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  if (!actor?.handle) return;

  const session = await createBskySession(group.bskyIdentifier, group.bskyAppPassword);
  if (!session) {
    console.warn(`[bsky] login failed for group ${actor.handle}`);
    return;
  }
  const origin = new URL(actor.uri).origin;
  const humanUrl = `${origin}/g/${actor.handle}/events/${event.id}`;
  const text = buildBskyAnnouncementText({
    title: event.title,
    startsAt: event.startsAt,
    venueName: event.venueName,
    humanUrl,
  });
  const uri = await postToBluesky(session, text, humanUrl);
  if (uri) console.log(`[bsky] crossposted ${eventId} -> ${uri}`);
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
