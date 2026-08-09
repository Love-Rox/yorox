import { Link } from 'waku';
import {
  unstable_getRequest as getRequest,
  unstable_notFound as notFound,
} from 'waku/router/server';
import { asc, eq } from 'drizzle-orm';
import { schema } from '../../../db/client';
import { PERMISSION_LABELS, PERMISSIONS } from '../../../domain/permissions';
import { HelpTip } from '../../../components/help-tip';
import { LoginRequired } from '../../../components/login-required';
import { getCurrentUser } from '../../../server/current-user';
import { getDb, getGroupByHandle } from '../../../server/data';
import { hasGroupPermission } from '../../../server/route-auth';

export default async function GroupSettingsPage({ handle }: { handle: string }) {
  const db = await getDb();
  const user = await getCurrentUser();
  if (!user) return <LoginRequired />;

  const result = await getGroupByHandle(db, handle);
  if (!result) return notFound();
  const { actor, group } = result;

  const canMembers = await hasGroupPermission(db, actor.id, user.actorId, 'member.manage');
  const canSettings = await hasGroupPermission(db, actor.id, user.actorId, 'group.settings');
  if (!canMembers && !canSettings) return notFound();

  const roles = await db.query.groupRoles.findMany({
    where: eq(schema.groupRoles.groupActorId, actor.id),
    orderBy: [asc(schema.groupRoles.createdAt)],
  });
  const members = await db
    .select({
      actorId: schema.actors.id,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      roleId: schema.groupMembers.roleId,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.actors, eq(schema.groupMembers.memberActorId, schema.actors.id))
    .where(eq(schema.groupMembers.groupActorId, actor.id))
    .orderBy(asc(schema.groupMembers.createdAt));

  const { env } = await import('cloudflare:workers');
  const { stripeConnectConfigured } = await import('../../../lib/stripe');
  const stripeAvailable = stripeConnectConfigured(env);

  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');

  return (
    <div className="max-w-2xl">
      <title>{`設定: ${actor.displayName} - Yorox`}</title>
      <p className="text-sm">
        <Link to={`/g/${handle}`} className="link">
          ← グループページへ戻る
        </Link>
      </p>
      <h1 className="display mt-2 t-lg">設定: {actor.displayName}</h1>

      {error && (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          {decodeURIComponent(error)}
        </p>
      )}

      {/* ---- グループ情報 ---- */}
      {canSettings && (
        <section className="mt-8">
          <h2 className="display border-b-2 border-ink pb-2 t-md">グループ情報</h2>
          <form
            method="post"
            action={`/g/${handle}/settings`}
            className="mt-4 space-y-4"
          >
            <label className="block">
              <span className="text-sm font-bold">表示名 *</span>
              <input
                type="text"
                name="display_name"
                required
                maxLength={80}
                defaultValue={actor.displayName}
                className="input mt-1"
              />
            </label>
            <label className="block">
              <span className="text-sm font-bold">紹介文(Markdown)</span>
              <textarea
                name="description_md"
                rows={5}
                defaultValue={group.descriptionMd ?? ''}
                className="input mt-1 leading-relaxed"
              />
            </label>
            <button type="submit" className="btn cursor-pointer">
              保存
            </button>
          </form>
        </section>
      )}

      {/* ---- Stripe 決済 ---- */}
      {canSettings && stripeAvailable && (
        <section id="stripe" className="mt-10 scroll-mt-4">
          <h2 className="display border-b-2 border-ink pb-2 t-md">
            Stripe 決済
            <HelpTip text="接続すると、有料枠で事前決済を受け付けられます。売上はこのグループの Stripe アカウントに直接入金され、Yorox は決済を仲介しません。決済完了は自動で参加確定になります。" />
          </h2>
          {group.stripeAccountId ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                接続中: <span className="meta-mono">{group.stripeAccountId}</span>
              </p>
              <form method="post" action={`/g/${handle}/settings/stripe/disconnect`}>
                <button
                  type="submit"
                  className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-ink"
                >
                  接続を解除
                </button>
              </form>
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-sm text-neutral">
                Stripe アカウントを接続すると、枠の支払方法で「Stripe(事前決済)」を
                選べるようになります。
              </p>
              <a
                href={`/g/${handle}/settings/stripe/connect`}
                className="btn mt-3 inline-block"
              >
                Stripe に接続する
              </a>
            </div>
          )}
        </section>
      )}

      {/* ---- Bluesky クロスポスト ---- */}
      {canSettings && (
        <section className="mt-10">
          <h2 className="display border-b-2 border-ink pb-2 t-md">
            Bluesky クロスポスト
            <HelpTip text="連携すると、イベント公開時にこのグループの Bluesky アカウントへ告知が自動投稿されます。通常のパスワードではなく、Bluesky の設定で発行できる App Password(いつでも失効可能)を使ってください。" />
          </h2>
          {group.bskyIdentifier ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p>
                連携中:{' '}
                <a
                  href={`https://bsky.app/profile/${group.bskyIdentifier}`}
                  className="link meta-mono"
                  rel="noreferrer"
                  target="_blank"
                >
                  @{group.bskyIdentifier}
                </a>
              </p>
              <form method="post" action={`/g/${handle}/settings/bluesky/disconnect`}>
                <button
                  type="submit"
                  className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-ink"
                >
                  連携を解除
                </button>
              </form>
            </div>
          ) : (
            <form
              method="post"
              action={`/g/${handle}/settings/bluesky`}
              className="mt-4 space-y-4"
            >
              <label className="block">
                <span className="text-sm font-bold">Bluesky ハンドル</span>
                <input
                  type="text"
                  name="bsky_identifier"
                  required
                  className="input meta-mono mt-1"
                  placeholder="example.bsky.social"
                />
              </label>
              <label className="block">
                <span className="text-sm font-bold">App Password</span>
                <input
                  type="password"
                  name="bsky_app_password"
                  required
                  className="input meta-mono mt-1"
                  placeholder="xxxx-xxxx-xxxx-xxxx"
                />
                <span className="mt-1 block text-sm text-neutral">
                  Bluesky の「設定 → プライバシーとセキュリティ → App Passwords」で
                  発行した専用パスワードを使ってください(通常のパスワードは使わないでください)
                </span>
              </label>
              <button type="submit" className="btn cursor-pointer">
                連携する
              </button>
            </form>
          )}
        </section>
      )}

      {/* ---- メンバー管理 ---- */}
      {canMembers && (
        <section className="mt-10">
          <h2 className="display border-b-2 border-ink pb-2 t-md">メンバー</h2>
          <ul className="mt-2">
            {members.map((m) => (
              <li
                key={m.actorId}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-rule py-3"
              >
                <div className="min-w-0">
                  <span className="font-bold">{m.displayName}</span>
                  {m.handle && (
                    <span className="meta-mono ml-2 text-sm text-neutral">@{m.handle}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form
                    method="post"
                    action={`/g/${handle}/members/${m.actorId}/role`}
                    className="flex items-center gap-2"
                  >
                    <select
                      name="role_id"
                      defaultValue={m.roleId}
                      className="input min-h-0 py-1.5 text-sm"
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="btn-quiet cursor-pointer text-sm">
                      変更
                    </button>
                  </form>
                  <form method="post" action={`/g/${handle}/members/${m.actorId}/remove`}>
                    <button
                      type="submit"
                      className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-accent"
                    >
                      削除
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>

          <details className="mt-4 border-2 border-ink">
            <summary className="cursor-pointer p-3 text-sm font-bold">メンバーを追加</summary>
            <form
              method="post"
              action={`/g/${handle}/members`}
              className="flex flex-wrap items-end gap-3 border-t-2 border-ink p-4"
            >
              <label className="block min-w-48 flex-1">
                <span className="text-sm font-bold">ハンドル</span>
                <input
                  type="text"
                  name="member_handle"
                  required
                  className="input meta-mono mt-1"
                  placeholder="@kyoto-taro"
                />
              </label>
              <label className="block">
                <span className="text-sm font-bold">ロール</span>
                <select
                  name="role_id"
                  defaultValue={roles.find((r) => r.name === 'メンバー')?.id}
                  className="input mt-1"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn cursor-pointer">
                追加
              </button>
            </form>
          </details>
        </section>
      )}

      {/* ---- ロール管理 ---- */}
      {canSettings && (
        <section className="mt-10">
          <h2 className="display border-b-2 border-ink pb-2 t-md">ロール</h2>
          <ul className="mt-2">
            {roles.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-rule py-3"
              >
                <div className="min-w-0">
                  <span className="font-bold">{r.name}</span>
                  {r.isPreset && (
                    <span className="meta-mono ml-2 border border-neutral px-1.5 py-0.5 text-sm text-neutral">
                      プリセット
                    </span>
                  )}
                  <div className="mt-0.5 text-sm text-neutral">
                    {r.permissions.length === 0
                      ? '権限なし(一般メンバー)'
                      : r.permissions
                          .map((p) => PERMISSION_LABELS[p as keyof typeof PERMISSION_LABELS] ?? p)
                          .join(' · ')}
                  </div>
                </div>
                {!r.isPreset && (
                  <form method="post" action={`/g/${handle}/roles/${r.id}/delete`}>
                    <button
                      type="submit"
                      className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-accent"
                    >
                      削除
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          <details className="mt-4 border-2 border-ink">
            <summary className="cursor-pointer p-3 text-sm font-bold">
              カスタムロールを作成
            </summary>
            <form
              method="post"
              action={`/g/${handle}/roles`}
              className="space-y-4 border-t-2 border-ink p-4"
            >
              <label className="block">
                <span className="text-sm font-bold">ロール名 *</span>
                <input
                  type="text"
                  name="name"
                  required
                  maxLength={50}
                  className="input mt-1"
                  placeholder="受付スタッフ"
                />
              </label>
              <fieldset>
                <legend className="text-sm font-bold">権限</legend>
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  {PERMISSIONS.map((p) => (
                    <label key={p} className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" name={`perm_${p}`} />
                      {PERMISSION_LABELS[p]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit" className="btn cursor-pointer">
                作成
              </button>
            </form>
          </details>
        </section>
      )}
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
