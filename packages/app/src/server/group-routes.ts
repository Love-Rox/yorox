/**
 * グループ作成・設定・メンバー管理のエンドポイント。
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb, schema } from '../db/client';
import { createBskySession } from '../lib/bluesky';
import { renderMarkdownToHtml } from '../lib/markdown';
import { ulid } from '../lib/ulid';
import { announceGroupPostDeleteNow, announceGroupPostNow } from './ap-delivery';
import {
  addMemberByHandle,
  AlreadyMemberError,
  changeMemberRole,
  createGroup,
  createRole,
  deleteRole,
  HandleTakenError,
  LastOwnerError,
  removeMember,
  RoleInUseError,
} from '../domain/groups';
import { PERMISSIONS, type Permission } from '../domain/permissions';
import { getSessionActorId, hasGroupPermission } from './route-auth';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

function assertSameOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  return origin === new URL(c.req.url).origin;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

type Db = ReturnType<typeof createDb>;

/** handle からグループを引き、指定権限を検証する */
async function authorizeForGroup(
  db: Db,
  handle: string,
  actorId: string,
  permission: Permission,
): Promise<{ groupActorId: string } | null> {
  const groupActor = await db.query.actors.findFirst({
    where: and(
      eq(schema.actors.handle, handle),
      isNull(schema.actors.domain),
      eq(schema.actors.kind, 'group'),
    ),
  });
  if (!groupActor) return null;
  const allowed = await hasGroupPermission(db, groupActor.id, actorId, permission);
  return allowed ? { groupActorId: groupActor.id } : null;
}

function redirectWithError(c: Context, path: string, err: unknown): Response {
  const message =
    err instanceof HandleTakenError ||
    err instanceof LastOwnerError ||
    err instanceof AlreadyMemberError ||
    err instanceof RoleInUseError ||
    err instanceof Error
      ? err.message
      : 'エラーが発生しました';
  return c.redirect(`${path}?error=${encodeURIComponent(message)}`, 302);
}

const groups = new Hono();

/** グループ作成 */
groups.post('/groups', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const form = await c.req.parseBody();
  const handle = str(form.handle).toLowerCase();
  try {
    await createGroup(db, {
      handle,
      displayName: str(form.display_name) || handle,
      descriptionMd: str(form.description_md) || undefined,
      ownerActorId: actorId,
      origin: new URL(c.req.url).origin,
    });
    return c.redirect(`/g/${handle}`, 302);
  } catch (err) {
    return redirectWithError(c, '/groups/new', err);
  }
});

/** グループ情報の更新 */
groups.post('/g/:handle/settings', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const ctx = await authorizeForGroup(db, handle, actorId, 'group.settings');
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const displayName = str(form.display_name);
  if (!displayName) {
    return c.redirect(`/g/${handle}/settings?error=${encodeURIComponent('表示名は必須です')}`, 302);
  }
  await db
    .update(schema.actors)
    .set({ displayName, summary: str(form.description_md) || null, updatedAt: new Date() })
    .where(eq(schema.actors.id, ctx.groupActorId));
  await db
    .update(schema.groups)
    .set({ descriptionMd: str(form.description_md) || null })
    .where(eq(schema.groups.actorId, ctx.groupActorId));
  return c.redirect(`/g/${handle}/settings`, 302);
});


/** Bluesky クロスポスト連携の登録(App Password を検証してから保存) */
groups.post('/g/:handle/settings/bluesky', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const ctx = await authorizeForGroup(db, handle, actorId, 'group.settings');
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const identifier = str(form.bsky_identifier).replace(/^@/, '');
  const appPassword = str(form.bsky_app_password);
  if (!identifier || !appPassword) {
    return c.redirect(
      `/g/${handle}/settings?error=${encodeURIComponent('Bluesky のハンドルと App Password を入力してください')}`,
      302,
    );
  }
  // 保存前にログインできるか検証する
  const session = await createBskySession(identifier, appPassword);
  if (!session) {
    return c.redirect(
      `/g/${handle}/settings?error=${encodeURIComponent('Bluesky にログインできませんでした。ハンドルと App Password を確認してください')}`,
      302,
    );
  }
  await db
    .update(schema.groups)
    .set({ bskyIdentifier: identifier, bskyAppPassword: appPassword })
    .where(eq(schema.groups.actorId, ctx.groupActorId));
  return c.redirect(`/g/${handle}/settings`, 302);
});

/** Bluesky 連携の解除 */
groups.post('/g/:handle/settings/bluesky/disconnect', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const ctx = await authorizeForGroup(db, handle, actorId, 'group.settings');
  if (!ctx) return c.text('権限がありません', 403);

  await db
    .update(schema.groups)
    .set({ bskyIdentifier: null, bskyAppPassword: null })
    .where(eq(schema.groups.actorId, ctx.groupActorId));
  return c.redirect(`/g/${handle}/settings`, 302);
});


/** グループのお知らせ投稿(タイムライン) */
groups.post('/g/:handle/posts', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const ctx = await authorizeForGroup(db, handle, actorId, 'event.create');
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const bodyMd = str(form.body).slice(0, 3000);
  if (!bodyMd) return c.redirect(`/g/${handle}`, 302);

  const post = {
    id: ulid(),
    groupActorId: ctx.groupActorId,
    authorActorId: actorId,
    bodyMd,
    createdAt: new Date(),
  };
  await db.insert(schema.groupPosts).values(post);
  // フォロワーへの配信+Bluesky クロスポスト(応答をブロックしない)
  c.executionCtx.waitUntil(
    announceGroupPostNow(db, ctx.groupActorId, {
      id: post.id,
      bodyHtml: renderMarkdownToHtml(bodyMd),
      bodyText: bodyMd,
      createdAt: post.createdAt,
    }),
  );
  return c.redirect(`/g/${handle}#timeline`, 302);
});

/** 投稿の削除(投稿者本人またはグループ設定権限) */
groups.post('/g/:handle/posts/:postId/delete', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const post = await db.query.groupPosts.findFirst({
    where: eq(schema.groupPosts.id, c.req.param('postId')),
  });
  if (!post) return c.notFound();
  const group = await db.query.actors.findFirst({
    where: eq(schema.actors.id, post.groupActorId),
  });
  if (!group || group.handle !== handle) return c.notFound();
  const allowed =
    post.authorActorId === actorId ||
    (await hasGroupPermission(db, post.groupActorId, actorId, 'group.settings'));
  if (!allowed) return c.text('権限がありません', 403);

  await db.delete(schema.groupPosts).where(eq(schema.groupPosts.id, post.id));
  // リモートに残った Note を Delete で消す
  c.executionCtx.waitUntil(announceGroupPostDeleteNow(db, group, post.id));
  return c.redirect(`/g/${handle}#timeline`, 302);
});

/** メンバー追加(handle 指定) */
groups.post('/g/:handle/members', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const ctx = await authorizeForGroup(db, handle, actorId, 'member.manage');
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  try {
    await addMemberByHandle(
      db,
      ctx.groupActorId,
      str(form.member_handle).replace(/^@/, '').toLowerCase(),
      str(form.role_id),
    );
    return c.redirect(`/g/${handle}/settings`, 302);
  } catch (err) {
    return redirectWithError(c, `/g/${handle}/settings`, err);
  }
});

/** ロール変更 */
groups.post('/g/:handle/members/:actorId/role', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const ctx = await authorizeForGroup(db, handle, actorId, 'member.manage');
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  try {
    await changeMemberRole(db, ctx.groupActorId, c.req.param('actorId'), str(form.role_id));
    return c.redirect(`/g/${handle}/settings`, 302);
  } catch (err) {
    return redirectWithError(c, `/g/${handle}/settings`, err);
  }
});

/** メンバー削除 */
groups.post('/g/:handle/members/:actorId/remove', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const ctx = await authorizeForGroup(db, handle, actorId, 'member.manage');
  if (!ctx) return c.text('権限がありません', 403);

  try {
    await removeMember(db, ctx.groupActorId, c.req.param('actorId'));
    return c.redirect(`/g/${handle}/settings`, 302);
  } catch (err) {
    return redirectWithError(c, `/g/${handle}/settings`, err);
  }
});

/** カスタムロール作成 */
groups.post('/g/:handle/roles', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const ctx = await authorizeForGroup(db, handle, actorId, 'group.settings');
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const permissions = PERMISSIONS.filter((p) => form[`perm_${p}`] === 'on');
  try {
    await createRole(db, ctx.groupActorId, str(form.name), permissions);
    return c.redirect(`/g/${handle}/settings`, 302);
  } catch (err) {
    return redirectWithError(c, `/g/${handle}/settings`, err);
  }
});

/** カスタムロール削除 */
groups.post('/g/:handle/roles/:roleId/delete', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const ctx = await authorizeForGroup(db, handle, actorId, 'group.settings');
  if (!ctx) return c.text('権限がありません', 403);

  try {
    await deleteRole(db, ctx.groupActorId, c.req.param('roleId'));
    return c.redirect(`/g/${handle}/settings`, 302);
  } catch (err) {
    return redirectWithError(c, `/g/${handle}/settings`, err);
  }
});

export default function groupRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', groups);
  return (_c, next) => next();
}
