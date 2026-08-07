/**
 * Hono ルート用の認証・認可ヘルパー。
 */
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { getSessionUserActorId, SESSION_COOKIE } from '../auth/session';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { hasPermission, type Permission } from '../domain/permissions';

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
  const rows = await db
    .select({ permissions: schema.groupRoles.permissions })
    .from(schema.groupMembers)
    .innerJoin(schema.groupRoles, eq(schema.groupMembers.roleId, schema.groupRoles.id))
    .where(
      and(
        eq(schema.groupMembers.groupActorId, groupActorId),
        eq(schema.groupMembers.memberActorId, memberActorId),
      ),
    );
  return rows.some((r) => hasPermission(r.permissions, permission));
}
