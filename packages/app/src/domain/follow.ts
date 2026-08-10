/**
 * ローカルユーザーのフォロー(タイムライン用)。
 *
 * follows テーブルは AP のフォロー(リモート → ローカルグループ)と共用する。
 * ローカルのフォローは activityUri を持たず、AP 配信の対象にもならない
 * (ap-delivery 側で domain IS NOT NULL に絞っている)。
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from '../lib/ulid';
import { emitDomainEvent } from './events';

/** フォローする。既にフォロー済みなら何もしない。自分自身は不可 */
export async function followActor(
  db: Db,
  followerActorId: string,
  followedActorId: string,
  now: Date = new Date(),
): Promise<void> {
  if (followerActorId === followedActorId) throw new Error('自分はフォローできません');
  const target = await db.query.actors.findFirst({
    where: eq(schema.actors.id, followedActorId),
  });
  // フォローできるのはこのインスタンスのユーザー/グループのみ
  if (!target || target.domain !== null) throw new Error('フォロー対象が見つかりません');

  const existing = await db.query.follows.findFirst({
    where: and(
      eq(schema.follows.followerActorId, followerActorId),
      eq(schema.follows.followedActorId, followedActorId),
    ),
  });
  if (existing) return;

  await db.insert(schema.follows).values({
    id: ulid(),
    followerActorId,
    followedActorId,
    activityUri: null,
    createdAt: now,
  });

  // フォローされた本人への通知(グループには個人の宛先が無いので出さない)
  if (target.kind === 'user') {
    const follower = await db.query.actors.findFirst({
      where: eq(schema.actors.id, followerActorId),
    });
    await emitDomainEvent(
      db,
      'follow.created',
      {
        actorId: followedActorId,
        followerActorId,
        followerName: follower?.displayName ?? '',
        followerHandle: follower?.handle ?? null,
      },
      now,
    );
  }
}

/** フォロー解除。フォローしていなければ何もしない */
export async function unfollowActor(
  db: Db,
  followerActorId: string,
  followedActorId: string,
): Promise<void> {
  await db
    .delete(schema.follows)
    .where(
      and(
        eq(schema.follows.followerActorId, followerActorId),
        eq(schema.follows.followedActorId, followedActorId),
      ),
    );
}

export async function isFollowing(
  db: Db,
  followerActorId: string,
  followedActorId: string,
): Promise<boolean> {
  const row = await db.query.follows.findFirst({
    where: and(
      eq(schema.follows.followerActorId, followerActorId),
      eq(schema.follows.followedActorId, followedActorId),
    ),
  });
  return !!row;
}

/** フォロー中のアクター ID 一覧(ローカルユーザーのフォローのみ) */
export async function listFollowedActorIds(db: Db, followerActorId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.follows.followedActorId })
    .from(schema.follows)
    .where(eq(schema.follows.followerActorId, followerActorId));
  return rows.map((r) => r.id);
}

/** フォロー中の数(自分のプロフィール表示用) */
export async function countFollowing(db: Db, followerActorId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.follows)
    .where(eq(schema.follows.followerActorId, followerActorId));
  return row?.n ?? 0;
}

export interface TimelineItem {
  kind: 'event' | 'post' | 'participation';
  at: Date;
  /** 発生源のアクター(グループ or ユーザー) */
  actorHandle: string | null;
  actorName: string;
  actorKind: 'user' | 'group';
  actorIsPersonalGroup: boolean;
  actorAvatarUrl: string | null;
  /** event / participation: 対象イベント */
  eventId?: string;
  eventTitle?: string;
  eventStartsAt?: Date;
  eventGroupHandle?: string | null;
  /** post: お知らせ本文(抜粋) */
  postExcerpt?: string;
  postGroupHandle?: string | null;
}

/**
 * タイムライン: フォロー中のアクターの公開活動を新しい順に混ぜて返す。
 *
 * - フォロー中のグループ: 公開イベント・お知らせ投稿
 * - フォロー中のユーザー: 公開イベントへの公開参加(本人が一覧非表示にした
 *   もの・参加者一覧が非公開のイベントは出さない)と、個人グループの公開イベント
 */
export async function buildTimeline(
  db: Db,
  followerActorId: string,
  limit = 50,
): Promise<TimelineItem[]> {
  const followedIds = await listFollowedActorIds(db, followerActorId);
  if (followedIds.length === 0) return [];

  const followedActors = await db.query.actors.findMany({
    where: inArray(schema.actors.id, followedIds),
  });
  const groupIds = followedActors.filter((a) => a.kind === 'group').map((a) => a.id);
  const userActors = followedActors.filter((a) => a.kind === 'user');

  // フォロー中ユーザーの個人グループ(handle 共有)もイベント供給源に含める
  const userHandles = userActors.map((a) => a.handle).filter((h): h is string => !!h);
  const personalGroups = userHandles.length
    ? await db
        .select({ actorId: schema.groups.actorId, handle: schema.actors.handle })
        .from(schema.groups)
        .innerJoin(schema.actors, eq(schema.groups.actorId, schema.actors.id))
        .where(
          and(
            eq(schema.groups.isPersonal, true),
            isNull(schema.actors.domain),
            inArray(schema.actors.handle, userHandles),
          ),
        )
    : [];
  const eventSourceGroupIds = [...new Set([...groupIds, ...personalGroups.map((g) => g.actorId)])];

  const items: TimelineItem[] = [];

  // 公開イベント(公開時刻の代わりに publishedAt、無ければ createdAt)
  if (eventSourceGroupIds.length > 0) {
    const events = await db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        startsAt: schema.events.startsAt,
        publishedAt: schema.events.publishedAt,
        createdAt: schema.events.createdAt,
        groupHandle: schema.actors.handle,
        groupName: schema.actors.displayName,
        groupAvatarUrl: schema.actors.avatarUrl,
        isPersonal: schema.groups.isPersonal,
      })
      .from(schema.events)
      .innerJoin(schema.actors, eq(schema.events.groupActorId, schema.actors.id))
      .innerJoin(schema.groups, eq(schema.events.groupActorId, schema.groups.actorId))
      .where(
        and(
          inArray(schema.events.groupActorId, eventSourceGroupIds),
          eq(schema.events.visibility, 'public'),
          isNull(schema.events.cancelledAt),
        ),
      )
      .orderBy(desc(schema.events.createdAt))
      .limit(limit);
    for (const e of events) {
      items.push({
        kind: 'event',
        at: e.publishedAt ?? e.createdAt,
        actorHandle: e.groupHandle,
        actorName: e.groupName,
        actorKind: 'group',
        actorIsPersonalGroup: e.isPersonal,
        actorAvatarUrl: e.groupAvatarUrl,
        eventId: e.id,
        eventTitle: e.title,
        eventStartsAt: e.startsAt,
        eventGroupHandle: e.groupHandle,
      });
    }
  }

  // グループのお知らせ
  if (groupIds.length > 0) {
    const posts = await db
      .select({
        body: schema.groupPosts.bodyMd,
        createdAt: schema.groupPosts.createdAt,
        groupHandle: schema.actors.handle,
        groupName: schema.actors.displayName,
        groupAvatarUrl: schema.actors.avatarUrl,
        isPersonal: schema.groups.isPersonal,
      })
      .from(schema.groupPosts)
      .innerJoin(schema.actors, eq(schema.groupPosts.groupActorId, schema.actors.id))
      .innerJoin(schema.groups, eq(schema.groupPosts.groupActorId, schema.groups.actorId))
      .where(inArray(schema.groupPosts.groupActorId, groupIds))
      .orderBy(desc(schema.groupPosts.createdAt))
      .limit(limit);
    for (const p of posts) {
      items.push({
        kind: 'post',
        at: p.createdAt,
        actorHandle: p.groupHandle,
        actorName: p.groupName,
        actorKind: 'group',
        actorIsPersonalGroup: p.isPersonal,
        actorAvatarUrl: p.groupAvatarUrl,
        postExcerpt: p.body.replace(/[#*_`>\-]/g, '').slice(0, 120),
        postGroupHandle: p.groupHandle,
      });
    }
  }

  // フォロー中ユーザーの公開参加(イベントページに出るものと同じ範囲だけ)
  const userIds = userActors.map((a) => a.id);
  if (userIds.length > 0) {
    const rows = await db
      .select({
        appliedAt: schema.participations.appliedAt,
        userHandle: schema.actors.handle,
        userName: schema.actors.displayName,
        userAvatarUrl: schema.actors.avatarUrl,
        eventId: schema.events.id,
        eventTitle: schema.events.title,
        eventStartsAt: schema.events.startsAt,
      })
      .from(schema.participations)
      .innerJoin(schema.actors, eq(schema.participations.actorId, schema.actors.id))
      .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
      .innerJoin(schema.events, eq(schema.slots.eventId, schema.events.id))
      .where(
        and(
          inArray(schema.participations.actorId, userIds),
          eq(schema.participations.status, 'accepted'),
          eq(schema.participations.hiddenFromList, false),
          eq(schema.events.visibility, 'public'),
          eq(schema.events.participantListPublic, true),
          isNull(schema.events.cancelledAt),
        ),
      )
      .orderBy(desc(schema.participations.appliedAt))
      .limit(limit);
    // イベントの主催 handle は表示リンクに使う
    const eventGroupHandles = new Map<string, string | null>();
    const eventIds = [...new Set(rows.map((r) => r.eventId))];
    if (eventIds.length > 0) {
      const groups = await db
        .select({ eventId: schema.events.id, handle: schema.actors.handle })
        .from(schema.events)
        .innerJoin(schema.actors, eq(schema.events.groupActorId, schema.actors.id))
        .where(inArray(schema.events.id, eventIds));
      for (const g of groups) eventGroupHandles.set(g.eventId, g.handle);
    }
    for (const r of rows) {
      items.push({
        kind: 'participation',
        at: r.appliedAt,
        actorHandle: r.userHandle,
        actorName: r.userName,
        actorKind: 'user',
        actorIsPersonalGroup: false,
        actorAvatarUrl: r.userAvatarUrl,
        eventId: r.eventId,
        eventTitle: r.eventTitle,
        eventStartsAt: r.eventStartsAt,
        eventGroupHandle: eventGroupHandles.get(r.eventId) ?? null,
      });
    }
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return items.slice(0, limit);
}

/**
 * イベント公開時、そのグループ(個人グループなら本人ユーザーも)を
 * フォローしているローカルユーザーへ通知イベントを積む。
 * @returns 積んだ通知数
 */
export async function notifyLocalFollowersOfPublish(
  db: Db,
  eventId: string,
  now: Date = new Date(),
): Promise<number> {
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
  if (!event) return 0;

  const targets = new Set<string>([event.groupActorId]);
  // 個人グループは handle を共有する本人ユーザーへのフォローも対象にする
  const groupActor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  const groupRow = await db.query.groups.findFirst({
    where: eq(schema.groups.actorId, event.groupActorId),
  });
  if (groupRow?.isPersonal && groupActor?.handle) {
    const owner = await db.query.actors.findFirst({
      where: and(
        eq(schema.actors.handle, groupActor.handle),
        isNull(schema.actors.domain),
        eq(schema.actors.kind, 'user'),
      ),
    });
    if (owner) targets.add(owner.id);
  }

  const followers = await db
    .select({ id: schema.follows.followerActorId })
    .from(schema.follows)
    .innerJoin(schema.actors, eq(schema.follows.followerActorId, schema.actors.id))
    .where(
      and(
        inArray(schema.follows.followedActorId, [...targets]),
        // 通知はローカルユーザーのみ(リモートは AP 告知が届く)
        isNull(schema.actors.domain),
        eq(schema.actors.kind, 'user'),
      ),
    );

  const seen = new Set<string>();
  let queued = 0;
  for (const f of followers) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    // 公開した本人には送らない
    if (f.id === event.createdByActorId) continue;
    await emitDomainEvent(db, 'event.followed_published', { eventId, actorId: f.id }, now);
    queued++;
  }
  return queued;
}
