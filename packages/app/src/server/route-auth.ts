/**
 * Hono ルート用の認証・認可ヘルパー。
 */
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { getSessionUserActorId, SESSION_COOKIE } from '../auth/session';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { getMemberPermissions } from '../domain/groups';
import type { Permission } from '../domain/permissions';

/** cookie からログイン中ユーザーの actorId を得る。未ログインなら null */
export async function getSessionActorId(db: Db, c: Context): Promise<string | null> {
  return getSessionUserActorId(db, getCookie(c, SESSION_COOKIE));
}

/**
 * グループ内で指定の権限を持つか。
 * @returns 持つなら true(非メンバー・権限なしは false)
 */
export async function hasGroupPermission(
  db: Db,
  groupActorId: string,
  memberActorId: string,
  permission: Permission,
): Promise<boolean> {
  return (await getMemberPermissions(db, groupActorId, memberActorId)).has(permission);
}

/** グループ内でそのメンバーが持つ全権限の和集合(非メンバーは空) */
export async function getGroupPermissions(
  db: Db,
  groupActorId: string,
  memberActorId: string,
): Promise<Set<string>> {
  return getMemberPermissions(db, groupActorId, memberActorId);
}

/** イベント共同管理者に与える運用権限(グループ設定・メンバー管理は含めない) */
const EVENT_MANAGER_PERMISSIONS: Permission[] = [
  'event.edit',
  'attendance.manage',
  'lottery.run',
];

/**
 * イベント共同管理者を追加・削除できるか。共同管理者には
 * EVENT_MANAGER_PERMISSIONS が付与されるため、付与者自身がそれらすべてを
 * グループの役割で持っていなければならない(共同管理者本人は不可)。
 * これを欠くと event.edit だけのメンバーが自分を共同管理者に追加して
 * 抽選・出欠・支払い(返金)の権限を得られてしまう。
 */
export async function canManageEventManagers(
  db: Db,
  event: { groupActorId: string },
  actorId: string,
): Promise<boolean> {
  const perms = await getMemberPermissions(db, event.groupActorId, actorId);
  return EVENT_MANAGER_PERMISSIONS.every((p) => perms.has(p));
}

/** そのイベントの共同管理者か */
export async function isEventManager(
  db: Db,
  eventId: string,
  actorId: string,
): Promise<boolean> {
  const row = await db.query.eventManagers.findFirst({
    where: and(
      eq(schema.eventManagers.eventId, eventId),
      eq(schema.eventManagers.actorId, actorId),
    ),
  });
  return !!row;
}

/**
 * イベントに対する権限。グループの役割で持つか、または
 * イベント共同管理者に付与される運用権限に含まれれば true。
 */
export async function hasEventPermission(
  db: Db,
  event: { id: string; groupActorId: string },
  actorId: string,
  permission: Permission,
): Promise<boolean> {
  if (await hasGroupPermission(db, event.groupActorId, actorId, permission)) return true;
  if (!EVENT_MANAGER_PERMISSIONS.includes(permission)) return false;
  return isEventManager(db, event.id, actorId);
}
