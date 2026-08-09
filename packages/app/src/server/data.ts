/**
 * RSC から使う読み取りクエリ集。
 * cloudflare:workers の env は workerd ランタイム内でのみ解決される。
 */
import { and, asc, desc, eq, gte, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { createDb, schema, type Db } from '../db/client';

export async function getDb(): Promise<Db> {
  const { env } = await import('cloudflare:workers');
  return createDb(env.DB);
}

/** 公開済みの今後のイベント一覧(トップページ用) */
export async function listUpcomingEvents(db: Db, limit = 20) {
  return db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      startsAt: schema.events.startsAt,
      venueName: schema.events.venueName,
      onlineUrl: schema.events.onlineUrl,
      thumbnailUrl: schema.events.thumbnailUrl,
      groupHandle: schema.actors.handle,
      groupName: schema.actors.displayName,
      groupIsPersonal: schema.groups.isPersonal,
    })
    .from(schema.events)
    .innerJoin(schema.actors, eq(schema.events.groupActorId, schema.actors.id))
    .innerJoin(schema.groups, eq(schema.events.groupActorId, schema.groups.actorId))
    .where(
      and(eq(schema.events.visibility, 'public'), gte(schema.events.startsAt, new Date())),
    )
    .orderBy(asc(schema.events.startsAt))
    .limit(limit);
}

/** handle からローカルグループを引く */
export async function getGroupByHandle(db: Db, handle: string) {
  const actor = await db.query.actors.findFirst({
    where: and(
      eq(schema.actors.handle, handle),
      isNull(schema.actors.domain),
      eq(schema.actors.kind, 'group'),
    ),
  });
  if (!actor) return null;
  const group = await db.query.groups.findFirst({
    where: eq(schema.groups.actorId, actor.id),
  });
  if (!group) return null;
  return { actor, group };
}

/** グループのイベント(新しい順)。主催メンバー向けには下書きも含める */
export async function listGroupEvents(
  db: Db,
  groupActorId: string,
  opts: { includeDrafts?: boolean; limit?: number } = {},
) {
  return db.query.events.findMany({
    where: opts.includeDrafts
      ? eq(schema.events.groupActorId, groupActorId)
      : and(
          eq(schema.events.groupActorId, groupActorId),
          eq(schema.events.visibility, 'public'),
        ),
    orderBy: [desc(schema.events.startsAt)],
    limit: opts.limit ?? 50,
  });
}

/** イベント詳細(枠・セッション・資料・参加者数まで) */
export async function getEventDetail(db: Db, eventId: string) {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
  });
  if (!event) return null;

  const groupActor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });

  const slots = await db.query.slots.findMany({
    where: eq(schema.slots.eventId, eventId),
    orderBy: [asc(schema.slots.sortOrder)],
  });

  const slotStats = new Map<string, { accepted: number; waitlisted: number }>();
  for (const slot of slots) {
    const rows = await db.query.participations.findMany({
      where: eq(schema.participations.slotId, slot.id),
    });
    slotStats.set(slot.id, {
      // payment_pending も席を保持しているため確定数に含める
      accepted: rows.filter(
        (r) => r.status === 'accepted' || r.status === 'payment_pending',
      ).length,
      waitlisted: rows.filter((r) => r.status === 'waitlisted' || r.status === 'consent_pending')
        .length,
    });
  }

  const sessions = await db.query.eventSessions.findMany({
    where: eq(schema.eventSessions.eventId, eventId),
    // 時刻付きを時刻順で先に、未設定は登録順で後ろに(タイムテーブル表示)
    orderBy: [
      sql`${schema.eventSessions.startsAt} IS NULL`,
      asc(schema.eventSessions.startsAt),
      asc(schema.eventSessions.sortOrder),
    ],
  });

  const materials = await db.query.materials.findMany({
    where: eq(schema.materials.eventId, eventId),
  });

  return { event, groupActor, slots, slotStats, sessions, materials };
}

/**
 * 管理コンソール用: 枠ごとの参加者(キャンセル除く)+ 出欠記録 + 過去実績。
 * 実績は自インスタンス分のみ(評判の連合はしない)。母数も返す(コールドスタート保護)。
 */
export async function listManageParticipations(db: Db, eventId: string) {
  const rows = await db
    .select({
      id: schema.participations.id,
      slotId: schema.participations.slotId,
      status: schema.participations.status,
      appliedAt: schema.participations.appliedAt,
      actorId: schema.actors.id,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      domain: schema.actors.domain,
      avatarUrl: schema.actors.avatarUrl,
      emojis: schema.actors.emojis,
      attendanceStatus: schema.attendances.status,
      paymentId: schema.payments.id,
      paymentStatus: schema.payments.status,
      paymentAmount: schema.payments.amount,
    })
    .from(schema.participations)
    .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
    .innerJoin(schema.actors, eq(schema.participations.actorId, schema.actors.id))
    .leftJoin(
      schema.attendances,
      eq(schema.attendances.participationId, schema.participations.id),
    )
    .leftJoin(
      schema.payments,
      eq(schema.payments.participationId, schema.participations.id),
    )
    .where(
      and(
        eq(schema.slots.eventId, eventId),
        // キャンセル済みは非表示。ただし要返金の支払いが残っている行は主催が
        // 対応する必要があるため表示し続ける
        or(
          ne(schema.participations.status, 'cancelled'),
          eq(schema.payments.status, 'refund_required'),
        ),
      ),
    )
    .orderBy(asc(schema.participations.appliedAt));

  // 過去実績(このイベントを除く全履歴)をアクター毎に集計
  const history = new Map<string, { attended: number; noShow: number }>();
  for (const row of rows) {
    if (history.has(row.actorId)) continue;
    const [stat] = await db
      .select({
        attended: sql<number>`sum(case when ${schema.attendances.status} = 'attended' then 1 else 0 end)`,
        noShow: sql<number>`sum(case when ${schema.attendances.status} = 'no_show' then 1 else 0 end)`,
      })
      .from(schema.attendances)
      .innerJoin(
        schema.participations,
        eq(schema.attendances.participationId, schema.participations.id),
      )
      .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
      .where(
        and(eq(schema.participations.actorId, row.actorId), ne(schema.slots.eventId, eventId)),
      );
    history.set(row.actorId, {
      attended: stat?.attended ?? 0,
      noShow: stat?.noShow ?? 0,
    });
  }
  return { rows, history };
}

/** 主催メンバー(event.edit 権限を持つロールのメンバー) */
export async function listOrganizers(db: Db, groupActorId: string) {
  const rows = await db
    .select({
      actorId: schema.actors.id,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      avatarUrl: schema.actors.avatarUrl,
      permissions: schema.groupRoles.permissions,
      roleName: schema.groupRoles.name,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.groupRoles, eq(schema.groupMembers.roleId, schema.groupRoles.id))
    .innerJoin(schema.actors, eq(schema.groupMembers.memberActorId, schema.actors.id))
    .where(eq(schema.groupMembers.groupActorId, groupActorId));
  return rows.filter((r) => r.permissions.includes('event.edit'));
}

/** グループのお知らせ投稿(新しい順、投稿者名付き) */
export async function listGroupPosts(db: Db, groupActorId: string, limit = 20) {
  return db
    .select({
      id: schema.groupPosts.id,
      bodyMd: schema.groupPosts.bodyMd,
      createdAt: schema.groupPosts.createdAt,
      authorActorId: schema.groupPosts.authorActorId,
      authorName: schema.actors.displayName,
    })
    .from(schema.groupPosts)
    .leftJoin(schema.actors, eq(schema.groupPosts.authorActorId, schema.actors.id))
    .where(eq(schema.groupPosts.groupActorId, groupActorId))
    .orderBy(desc(schema.groupPosts.createdAt))
    .limit(limit);
}

/** AP フォロワー数 */
export async function countFollowers(db: Db, actorId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.follows)
    .where(eq(schema.follows.followedActorId, actorId));
  return row?.n ?? 0;
}

/** 自分の参加状態(イベント内の全枠分) */
export async function getOwnParticipations(db: Db, eventId: string, actorId: string) {
  const rows = await db
    .select({
      id: schema.participations.id,
      slotId: schema.participations.slotId,
      status: schema.participations.status,
      hiddenFromList: schema.participations.hiddenFromList,
      paymentId: schema.payments.id,
    })
    .from(schema.participations)
    .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
    .leftJoin(schema.payments, eq(schema.payments.participationId, schema.participations.id))
    .where(and(eq(schema.slots.eventId, eventId), eq(schema.participations.actorId, actorId)));
  return new Map(rows.filter((r) => r.status !== 'cancelled').map((r) => [r.slotId, r]));
}

/** 参加者一覧(確定者のみ、本人が隠している人を除く) */
export async function listVisibleParticipants(db: Db, eventId: string) {
  const claimedActor = alias(schema.actors, 'claimed_actor');
  return db
    .select({
      actorId: schema.actors.id,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      domain: schema.actors.domain,
      uri: schema.actors.uri,
      avatarUrl: schema.actors.avatarUrl,
      emojis: schema.actors.emojis,
      /** claim 済みリモートの場合、紐付いたローカルアカウントの handle */
      claimedHandle: claimedActor.handle,
      slotId: schema.participations.slotId,
    })
    .from(schema.participations)
    .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
    .innerJoin(schema.actors, eq(schema.participations.actorId, schema.actors.id))
    .leftJoin(claimedActor, eq(schema.actors.claimedByActorId, claimedActor.id))
    .where(
      and(
        eq(schema.slots.eventId, eventId),
        eq(schema.participations.status, 'accepted'),
        eq(schema.participations.hiddenFromList, false),
      ),
    )
    .orderBy(asc(schema.participations.appliedAt));
}
