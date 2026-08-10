/**
 * アカウントのデータエクスポートと退会(削除)。
 *
 * 退会の方針(連合とデータ保全の両立):
 * - 認証情報・連絡先など「本人の個人情報」は物理削除する
 *   (users 行 = メール、セッション、パスキー、OAuth、claim コード等)
 * - 進行中の参加はキャンセルして席を解放する
 * - actor 行は AP URI の不変性と、主催者側に残る出欠・イベント記録の
 *   参照整合性のため tombstone(匿名化)として残す
 * - 個人グループは、他者の参加が無ければ物理削除、あれば匿名化して残す
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { hasPermission } from './permissions';
import { cancelParticipation } from './participation';

const TOMBSTONE_NAME = '退会したユーザー';
const ACTIVE_STATUSES = [
  'applied',
  'accepted',
  'payment_pending',
  'waitlisted',
  'consent_pending',
] as const;

/** 本人+claim 済みリモートエイリアスの actorId 一覧 */
async function identityActorIds(db: Db, userActorId: string): Promise<string[]> {
  const aliases = await db.query.actors.findMany({
    where: eq(schema.actors.claimedByActorId, userActorId),
  });
  return [userActorId, ...aliases.map((a) => a.id)];
}

export interface AccountExport {
  exportedAt: string;
  profile: {
    id: string;
    handle: string | null;
    displayName: string;
    summary: string | null;
    avatarUrl: string | null;
    profileLinks: string[] | null;
    uri: string;
    createdAt: string | null;
    email: string | null;
    emailNotifications: boolean | null;
  };
  aliases: { handle: string | null; domain: string | null; uri: string }[];
  groupMemberships: { group: string | null; displayName: string; role: string }[];
  participations: {
    event: string;
    eventStartsAt: string | null;
    group: string | null;
    slot: string;
    status: string;
    appliedAt: string | null;
    attendance: string | null;
  }[];
  payments: {
    event: string;
    amount: number;
    currency: string;
    status: string;
    provider: string | null;
    createdAt: string | null;
  }[];
}

/** ログインユーザーの全データを JSON エクスポート用に集約する */
export async function exportUserData(db: Db, userActorId: string): Promise<AccountExport> {
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, userActorId),
  });
  if (!actor) throw new Error('アカウントが見つかりません');
  const user = await db.query.users.findFirst({
    where: eq(schema.users.actorId, userActorId),
  });

  const ids = await identityActorIds(db, userActorId);
  const aliases = await db.query.actors.findMany({
    where: eq(schema.actors.claimedByActorId, userActorId),
  });

  // グループ参加(個人グループ含む)
  const memberships = await db
    .select({
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
      role: schema.groupRoles.name,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.actors, eq(schema.groupMembers.groupActorId, schema.actors.id))
    .innerJoin(schema.groupRoles, eq(schema.groupMembers.roleId, schema.groupRoles.id))
    .where(eq(schema.groupMembers.memberActorId, userActorId));

  // 参加履歴(出欠付き)
  const parts = await db
    .select({
      partId: schema.participations.id,
      status: schema.participations.status,
      appliedAt: schema.participations.appliedAt,
      slotName: schema.slots.name,
      eventTitle: schema.events.title,
      eventStartsAt: schema.events.startsAt,
      groupHandle: schema.actors.handle,
    })
    .from(schema.participations)
    .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
    .innerJoin(schema.events, eq(schema.slots.eventId, schema.events.id))
    .innerJoin(schema.actors, eq(schema.events.groupActorId, schema.actors.id))
    .where(inArray(schema.participations.actorId, ids));

  const attendanceRows = await db
    .select({
      participationId: schema.attendances.participationId,
      status: schema.attendances.status,
    })
    .from(schema.attendances)
    .where(
      inArray(
        schema.attendances.participationId,
        parts.map((p) => p.partId).length ? parts.map((p) => p.partId) : [''],
      ),
    );
  const attendanceByPart = new Map(attendanceRows.map((a) => [a.participationId, a.status]));

  // 支払い
  const paymentRows = await db
    .select({
      amount: schema.payments.amount,
      currency: schema.payments.currency,
      status: schema.payments.status,
      provider: schema.payments.provider,
      createdAt: schema.payments.createdAt,
      eventTitle: schema.events.title,
    })
    .from(schema.payments)
    .innerJoin(schema.participations, eq(schema.payments.participationId, schema.participations.id))
    .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
    .innerJoin(schema.events, eq(schema.slots.eventId, schema.events.id))
    .where(inArray(schema.participations.actorId, ids));

  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: actor.id,
      handle: actor.handle,
      displayName: actor.displayName,
      summary: actor.summary,
      avatarUrl: actor.avatarUrl,
      profileLinks: actor.profileLinks,
      uri: actor.uri,
      createdAt: iso(actor.createdAt),
      email: user?.email ?? null,
      emailNotifications: user?.emailNotifications ?? null,
    },
    aliases: aliases.map((a) => ({ handle: a.handle, domain: a.domain, uri: a.uri })),
    groupMemberships: memberships.map((m) => ({
      group: m.handle,
      displayName: m.displayName,
      role: m.role,
    })),
    participations: parts.map((p) => ({
      event: p.eventTitle,
      eventStartsAt: iso(p.eventStartsAt),
      group: p.groupHandle,
      slot: p.slotName,
      status: p.status,
      appliedAt: iso(p.appliedAt),
      attendance: attendanceByPart.get(p.partId) ?? null,
    })),
    payments: paymentRows.map((p) => ({
      event: p.eventTitle,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      provider: p.provider,
      createdAt: iso(p.createdAt),
    })),
  };
}

export interface DeleteBlock {
  ok: false;
  /** 引き継ぎ or 削除が必要な、本人が唯一の管理者になっている共同グループ */
  groups: { handle: string | null; displayName: string }[];
}
export type DeleteResult = { ok: true } | DeleteBlock;

/**
 * 本人が member.manage を持つ非個人グループのうち、他に管理者がいないものを探す。
 * これらは退会前に引き継ぎ/削除が必要(データを孤児にしないため)。
 */
async function findSoleAdminGroups(
  db: Db,
  userActorId: string,
): Promise<{ handle: string | null; displayName: string }[]> {
  const rows = await db
    .select({
      groupActorId: schema.groupMembers.groupActorId,
      memberActorId: schema.groupMembers.memberActorId,
      permissions: schema.groupRoles.permissions,
      isPersonal: schema.groups.isPersonal,
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.groupRoles, eq(schema.groupMembers.roleId, schema.groupRoles.id))
    .innerJoin(schema.groups, eq(schema.groupMembers.groupActorId, schema.groups.actorId))
    .innerJoin(schema.actors, eq(schema.groupMembers.groupActorId, schema.actors.id));

  // グループごとに集計
  const byGroup = new Map<
    string,
    { admins: Set<string>; isPersonal: boolean; handle: string | null; displayName: string }
  >();
  for (const r of rows) {
    let g = byGroup.get(r.groupActorId);
    if (!g) {
      g = {
        admins: new Set(),
        isPersonal: r.isPersonal,
        handle: r.handle,
        displayName: r.displayName,
      };
      byGroup.set(r.groupActorId, g);
    }
    if (hasPermission(r.permissions as string[], 'member.manage')) {
      g.admins.add(r.memberActorId);
    }
  }

  const blocked: { handle: string | null; displayName: string }[] = [];
  for (const g of byGroup.values()) {
    if (g.isPersonal) continue;
    if (g.admins.has(userActorId) && g.admins.size === 1) {
      blocked.push({ handle: g.handle, displayName: g.displayName });
    }
  }
  return blocked;
}

/**
 * アカウントを削除(退会)する。
 * 唯一の管理者になっている共同グループがある場合はブロックして一覧を返す。
 */
export async function deleteAccount(
  db: Db,
  userActorId: string,
  now: Date = new Date(),
): Promise<DeleteResult> {
  const soleAdmin = await findSoleAdminGroups(db, userActorId);
  if (soleAdmin.length > 0) return { ok: false, groups: soleAdmin };

  const ids = await identityActorIds(db, userActorId);

  // 1. 進行中の参加をキャンセル(席の解放・返金フラグ・繰上げを含む)
  const active = await db
    .select({ id: schema.participations.id })
    .from(schema.participations)
    .where(
      and(
        inArray(schema.participations.actorId, ids),
        inArray(schema.participations.status, [...ACTIVE_STATUSES]),
      ),
    );
  for (const p of active) {
    await cancelParticipation(db, p.id, now);
  }

  // 2. 認証・連絡先の物理削除
  await db.delete(schema.authSessions).where(eq(schema.authSessions.userActorId, userActorId));
  await db
    .delete(schema.emailChangeTokens)
    .where(eq(schema.emailChangeTokens.userActorId, userActorId));
  await db.delete(schema.passkeys).where(eq(schema.passkeys.userActorId, userActorId));
  await db.delete(schema.oauthAccounts).where(eq(schema.oauthAccounts.userActorId, userActorId));
  const user = await db.query.users.findFirst({
    where: eq(schema.users.actorId, userActorId),
  });
  if (user) {
    await db.delete(schema.loginTokens).where(eq(schema.loginTokens.email, user.email));
  }
  await db.delete(schema.claimCodes).where(eq(schema.claimCodes.userActorId, userActorId));

  // 3. 他グループ(非個人)のメンバーシップとイベント管理者権限を解除。
  //    個人グループの後始末は手順6で行う
  const personalGroupRows = await db.query.groups.findMany({
    where: eq(schema.groups.isPersonal, true),
  });
  const personalGroupIds = new Set(personalGroupRows.map((p) => p.actorId));
  const memberships = await db.query.groupMembers.findMany({
    where: eq(schema.groupMembers.memberActorId, userActorId),
  });
  for (const m of memberships) {
    if (personalGroupIds.has(m.groupActorId)) continue;
    await db
      .delete(schema.groupMembers)
      .where(
        and(
          eq(schema.groupMembers.memberActorId, userActorId),
          eq(schema.groupMembers.groupActorId, m.groupActorId),
        ),
      );
  }
  await db.delete(schema.eventManagers).where(eq(schema.eventManagers.actorId, userActorId));

  // 4. claim 済みリモートエイリアスを解除(remote アクター自体は残す)
  await db
    .update(schema.actors)
    .set({ claimedByActorId: null, updatedAt: now })
    .where(eq(schema.actors.claimedByActorId, userActorId));

  // 5. users 行の削除(メール等 PII の消去)
  await db.delete(schema.users).where(eq(schema.users.actorId, userActorId));

  // 6. 個人グループの後始末: 他者の参加があるイベントが無ければ物理削除、あれば匿名化
  const personalGroups = await db
    .select({ actorId: schema.groups.actorId })
    .from(schema.groups)
    .innerJoin(schema.groupMembers, eq(schema.groups.actorId, schema.groupMembers.groupActorId))
    .where(and(eq(schema.groups.isPersonal, true), eq(schema.groupMembers.memberActorId, userActorId)));
  for (const pg of personalGroups) {
    await purgeOrTombstonePersonalGroup(db, pg.actorId, now);
  }

  // 7. 本人 actor を tombstone(匿名化)。AP URI と参照整合性のため行は残す
  await db
    .update(schema.actors)
    .set({
      displayName: TOMBSTONE_NAME,
      summary: null,
      avatarUrl: null,
      profileLinks: null,
      handle: null,
      privateKeyPem: null,
      updatedAt: now,
    })
    .where(eq(schema.actors.id, userActorId));

  return { ok: true };
}

/** 個人グループを、外部参加が無ければ物理削除、あれば匿名化して残す */
async function purgeOrTombstonePersonalGroup(
  db: Db,
  groupActorId: string,
  now: Date,
): Promise<void> {
  const events = await db.query.events.findMany({
    where: eq(schema.events.groupActorId, groupActorId),
  });

  // 本人以外の参加があるか(あれば削除せず匿名化)
  let hasForeignParticipation = false;
  for (const ev of events) {
    const slots = await db.query.slots.findMany({ where: eq(schema.slots.eventId, ev.id) });
    for (const s of slots) {
      const others = await db
        .select({ id: schema.participations.id })
        .from(schema.participations)
        .where(
          and(
            eq(schema.participations.slotId, s.id),
            ne(schema.participations.status, 'cancelled'),
          ),
        );
      if (others.length > 0) {
        hasForeignParticipation = true;
        break;
      }
    }
    if (hasForeignParticipation) break;
  }

  if (hasForeignParticipation) {
    // 匿名化して残す(過去の参加記録を保全)
    await db
      .update(schema.actors)
      .set({ displayName: TOMBSTONE_NAME, summary: null, avatarUrl: null, handle: null, updatedAt: now })
      .where(eq(schema.actors.id, groupActorId));
    return;
  }

  // 外部参加が無い → 個人グループとその従属行を物理削除
  for (const ev of events) {
    const slots = await db.query.slots.findMany({ where: eq(schema.slots.eventId, ev.id) });
    for (const s of slots) {
      await db.delete(schema.participations).where(eq(schema.participations.slotId, s.id));
      await db.delete(schema.slots).where(eq(schema.slots.id, s.id));
    }
    await db.delete(schema.eventSessions).where(eq(schema.eventSessions.eventId, ev.id));
    await db.delete(schema.materials).where(eq(schema.materials.eventId, ev.id));
    await db.delete(schema.eventManagers).where(eq(schema.eventManagers.eventId, ev.id));
    await db.delete(schema.events).where(eq(schema.events.id, ev.id));
  }
  await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupActorId, groupActorId));
  await db.delete(schema.groupRoles).where(eq(schema.groupRoles.groupActorId, groupActorId));
  await db.delete(schema.groupPosts).where(eq(schema.groupPosts.groupActorId, groupActorId));
  await db.delete(schema.follows).where(eq(schema.follows.followedActorId, groupActorId));
  await db.delete(schema.groups).where(eq(schema.groups.actorId, groupActorId));
  await db.delete(schema.actors).where(eq(schema.actors.id, groupActorId));
}
