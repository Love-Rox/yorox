/**
 * ローカルユーザーの作成(サインアップ)。
 *
 * handle ルール(docs/OPEN-QUESTIONS.md #2):
 * - ユーザーと「本人の個人グループ」は同じ handle を共有する
 * - それ以外の cross-kind 重複(無関係なユーザーとグループ)は禁止
 * サインアップ時に個人グループを自動作成する(#6、GitHub 方式)。
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from '../lib/ulid';
import { HandleTakenError, validateHandle } from './groups';
import { PRESET_ROLES } from './permissions';

export class EmailTakenError extends Error {
  constructor() {
    super('このメールアドレスは既に登録されています');
    this.name = 'EmailTakenError';
  }
}

/** ローカルで handle が使えるか(kind を問わず衝突を調べる) */
export async function isHandleAvailable(db: Db, handle: string): Promise<boolean> {
  const existing = await db.query.actors.findFirst({
    where: and(eq(schema.actors.handle, handle), isNull(schema.actors.domain)),
  });
  return !existing;
}

export interface CreateUserInput {
  email: string; // マジックリンクで検証済みであること
  handle: string;
  displayName: string;
  origin: string;
}

/**
 * ユーザーアクター + users 行 + 個人グループ(同一 handle)+ プリセットロールを作成する。
 */
export async function createUser(
  db: Db,
  input: CreateUserInput,
  now: Date = new Date(),
): Promise<{ userActorId: string; personalGroupActorId: string }> {
  if (!validateHandle(input.handle)) {
    throw new Error(`ハンドルの形式が不正です: ${input.handle}`);
  }
  // 個人グループとペアで作るため、kind を問わず空いている必要がある
  if (!(await isHandleAvailable(db, input.handle))) {
    throw new HandleTakenError(input.handle);
  }
  const emailTaken = await db.query.users.findFirst({
    where: eq(schema.users.email, input.email),
  });
  if (emailTaken) throw new EmailTakenError();

  // ユーザーアクター(AP 露出は当面しないが URI は予約する)
  const userActorId = ulid();
  const userUri = `${input.origin}/users/${userActorId}`;
  await db.insert(schema.actors).values({
    id: userActorId,
    kind: 'user',
    state: 'local',
    handle: input.handle,
    domain: null,
    uri: userUri,
    inboxUrl: `${userUri}/inbox`,
    displayName: input.displayName,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values({
    actorId: userActorId,
    email: input.email,
    emailVerifiedAt: now,
    createdAt: now,
  });

  // 個人グループ(同一 handle)。groups.ts の createGroup は kind 横断の
  // handle 重複を拒否するため、ここでは直接作成する(personal ペアの特例)
  const groupActorId = ulid();
  const groupUri = `${input.origin}/groups/${groupActorId}`;
  await db.insert(schema.actors).values({
    id: groupActorId,
    kind: 'group',
    state: 'local',
    handle: input.handle,
    domain: null,
    uri: groupUri,
    inboxUrl: `${groupUri}/inbox`,
    displayName: input.displayName,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.groups).values({
    actorId: groupActorId,
    isPersonal: true,
    createdAt: now,
  });

  const roleIds = new Map<string, string>();
  for (const preset of PRESET_ROLES) {
    const roleId = ulid();
    roleIds.set(preset.name, roleId);
    await db.insert(schema.groupRoles).values({
      id: roleId,
      groupActorId: groupActorId,
      name: preset.name,
      permissions: preset.permissions,
      isPreset: true,
      createdAt: now,
    });
  }
  await db.insert(schema.groupMembers).values({
    groupActorId: groupActorId,
    memberActorId: userActorId,
    roleId: roleIds.get('オーナー')!,
    createdAt: now,
  });

  return { userActorId, personalGroupActorId: groupActorId };
}
