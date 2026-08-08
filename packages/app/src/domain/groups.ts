/**
 * グループ作成・メンバー管理のドメインサービス。
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from '../lib/ulid';
import { hasAllPermissions, PRESET_ROLES } from './permissions';

export class HandleTakenError extends Error {
  constructor(handle: string) {
    super(`ハンドル "${handle}" は既に使われています`);
    this.name = 'HandleTakenError';
  }
}

export class LastOwnerError extends Error {
  constructor() {
    super('全権限を持つメンバーが最低1人必要です');
    this.name = 'LastOwnerError';
  }
}

const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function validateHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}

export interface CreateGroupInput {
  handle: string;
  displayName: string;
  descriptionMd?: string | undefined;
  isPersonal?: boolean | undefined;
  /** 作成者(オーナーになるローカルユーザーのアクター ID) */
  ownerActorId: string;
  /** AP URI 組み立て用のオリジン(例: https://yorox.example) */
  origin: string;
}

/**
 * グループを作成する。
 * - グループ用アクター(kind=group, state=local)を発行
 * - プリセットロール(オーナー/共同主催/メンバー)を投入
 * - 作成者をオーナーとして参加させる
 */
export async function createGroup(db: Db, input: CreateGroupInput) {
  if (!validateHandle(input.handle)) {
    throw new Error(`ハンドルの形式が不正です: ${input.handle}`);
  }

  const existing = await db.query.actors.findFirst({
    where: and(eq(schema.actors.handle, input.handle), isNull(schema.actors.domain)),
  });
  if (existing) throw new HandleTakenError(input.handle);

  const now = new Date();
  const actorId = ulid();
  const uri = `${input.origin}/groups/${actorId}`;

  await db.insert(schema.actors).values({
    id: actorId,
    kind: 'group',
    state: 'local',
    handle: input.handle,
    domain: null,
    uri,
    inboxUrl: `${uri}/inbox`,
    displayName: input.displayName,
    summary: input.descriptionMd ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.groups).values({
    actorId,
    isPersonal: input.isPersonal ?? false,
    descriptionMd: input.descriptionMd ?? null,
    createdAt: now,
  });

  const roleIds = new Map<string, string>();
  for (const preset of PRESET_ROLES) {
    const roleId = ulid();
    roleIds.set(preset.name, roleId);
    await db.insert(schema.groupRoles).values({
      id: roleId,
      groupActorId: actorId,
      name: preset.name,
      permissions: preset.permissions,
      isPreset: true,
      createdAt: now,
    });
  }

  await db.insert(schema.groupMembers).values({
    groupActorId: actorId,
    memberActorId: input.ownerActorId,
    roleId: roleIds.get('オーナー')!,
    createdAt: now,
  });

  return { actorId, uri };
}

export class AlreadyMemberError extends Error {
  constructor() {
    super('既にメンバーです');
    this.name = 'AlreadyMemberError';
  }
}

export class RoleInUseError extends Error {
  constructor() {
    super('このロールは使用中のため削除できません');
    this.name = 'RoleInUseError';
  }
}

/** ローカルユーザーを handle で探してメンバー追加する */
export async function addMemberByHandle(
  db: Db,
  groupActorId: string,
  handle: string,
  roleId: string,
  now: Date = new Date(),
): Promise<void> {
  const actor = await db.query.actors.findFirst({
    where: and(
      eq(schema.actors.handle, handle),
      isNull(schema.actors.domain),
      eq(schema.actors.kind, 'user'),
    ),
  });
  if (!actor) throw new Error(`ユーザー @${handle} が見つかりません`);

  const existing = await db.query.groupMembers.findFirst({
    where: and(
      eq(schema.groupMembers.groupActorId, groupActorId),
      eq(schema.groupMembers.memberActorId, actor.id),
    ),
  });
  if (existing) throw new AlreadyMemberError();

  const role = await db.query.groupRoles.findFirst({
    where: and(eq(schema.groupRoles.id, roleId), eq(schema.groupRoles.groupActorId, groupActorId)),
  });
  if (!role) throw new Error('ロールが見つかりません');

  await db.insert(schema.groupMembers).values({
    groupActorId,
    memberActorId: actor.id,
    roleId,
    createdAt: now,
  });
}

/** ロール変更(全権限を失う場合は最終オーナー保護) */
export async function changeMemberRole(
  db: Db,
  groupActorId: string,
  memberActorId: string,
  newRoleId: string,
): Promise<void> {
  const newRole = await db.query.groupRoles.findFirst({
    where: and(
      eq(schema.groupRoles.id, newRoleId),
      eq(schema.groupRoles.groupActorId, groupActorId),
    ),
  });
  if (!newRole) throw new Error('ロールが見つかりません');

  if (!hasAllPermissions(newRole.permissions)) {
    await assertNotLastOwner(db, groupActorId, memberActorId);
  }
  await db
    .update(schema.groupMembers)
    .set({ roleId: newRoleId })
    .where(
      and(
        eq(schema.groupMembers.groupActorId, groupActorId),
        eq(schema.groupMembers.memberActorId, memberActorId),
      ),
    );
}

/** メンバー削除(最終オーナー保護) */
export async function removeMember(
  db: Db,
  groupActorId: string,
  memberActorId: string,
): Promise<void> {
  await assertNotLastOwner(db, groupActorId, memberActorId);
  await db
    .delete(schema.groupMembers)
    .where(
      and(
        eq(schema.groupMembers.groupActorId, groupActorId),
        eq(schema.groupMembers.memberActorId, memberActorId),
      ),
    );
}

/** カスタムロール作成 */
export async function createRole(
  db: Db,
  groupActorId: string,
  name: string,
  permissions: string[],
  now: Date = new Date(),
): Promise<void> {
  if (!name.trim()) throw new Error('ロール名は必須です');
  const { ulid } = await import('../lib/ulid');
  await db.insert(schema.groupRoles).values({
    id: ulid(),
    groupActorId,
    name: name.trim(),
    permissions,
    isPreset: false,
    createdAt: now,
  });
}

/** カスタムロール削除(プリセット不可・使用中不可) */
export async function deleteRole(db: Db, groupActorId: string, roleId: string): Promise<void> {
  const role = await db.query.groupRoles.findFirst({
    where: and(eq(schema.groupRoles.id, roleId), eq(schema.groupRoles.groupActorId, groupActorId)),
  });
  if (!role) return;
  if (role.isPreset) throw new Error('プリセットロールは削除できません');

  const inUse = await db.query.groupMembers.findFirst({
    where: eq(schema.groupMembers.roleId, roleId),
  });
  if (inUse) throw new RoleInUseError();

  await db.delete(schema.groupRoles).where(eq(schema.groupRoles.id, roleId));
}

/**
 * メンバーのロール変更・脱退の前に呼ぶガード。
 * 変更後もグループに全権限持ちが残るかを検証する。
 *
 * @param excludeMemberActorId ロールを失う(または脱退する)メンバー
 */
export async function assertNotLastOwner(
  db: Db,
  groupActorId: string,
  excludeMemberActorId: string,
): Promise<void> {
  const rows = await db
    .select({
      memberActorId: schema.groupMembers.memberActorId,
      permissions: schema.groupRoles.permissions,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.groupRoles, eq(schema.groupMembers.roleId, schema.groupRoles.id))
    .where(
      and(
        eq(schema.groupMembers.groupActorId, groupActorId),
        ne(schema.groupMembers.memberActorId, excludeMemberActorId),
      ),
    );

  const stillHasOwner = rows.some((r) => hasAllPermissions(r.permissions));
  if (!stillHasOwner) throw new LastOwnerError();
}
