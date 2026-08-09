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
import { SectionNavLayout, type SectionNavItem } from '../../../components/section-nav';

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

  const { TOKUSHOHO_FIELDS, tokushohoTemplate } = await import(
    '../../../domain/tokushoho'
  );
  const tokushohoFields = TOKUSHOHO_FIELDS;
  const tokushohoValues = { ...tokushohoTemplate(), ...(group.tokushoho ?? {}) };

  const { listBlocks } = await import('../../../domain/blocks');
  const blocks = canMembers ? await listBlocks(db, actor.id) : [];

  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');
  const blockError = url.searchParams.get('block_error');

  const sections: SectionNavItem[] = [
    ...(canSettings ? [{ id: 'info', label: 'グループ情報' }] : []),
    ...(canSettings && stripeAvailable ? [{ id: 'stripe', label: '決済(Stripe)' }] : []),
    ...(canSettings ? [{ id: 'tokushoho', label: '特定商取引法' }] : []),
    ...(canSettings ? [{ id: 'bluesky', label: 'Bluesky クロスポスト' }] : []),
    ...(canMembers ? [{ id: 'members', label: 'メンバー' }] : []),
    ...(canMembers ? [{ id: 'blocks', label: '参加者ブロック' }] : []),
    ...(canSettings ? [{ id: 'roles', label: 'ロール' }] : []),
  ];

  return (
    <div>
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

      <div className="mt-6">
        <SectionNavLayout title="グループ設定" items={sections}>
      {/* ---- グループ情報 ---- */}
      {canSettings && (
        <section id="info" className="mt-8 scroll-mt-4">
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

      {/* ---- 特定商取引法に基づく表記 ---- */}
      {canSettings && (
        <section id="tokushoho" className="mt-10 scroll-mt-4">
          <h2 className="display border-b-2 border-ink pb-2 t-md">
            特定商取引法に基づく表記
            <HelpTip text="有料イベントを開催する場合、通信販売の事業者として表記の義務があります。ここで設定するとグループの公開ページに表示されます。" />
          </h2>

          <div className="mt-3 border-2 border-accent p-3 text-sm">
            <p className="font-bold text-accent">これはテンプレート(雛形)です</p>
            <p className="mt-1">
              入力欄には一般的な例をあらかじめ入れてありますが、
              <strong>そのままで法的要件を満たすことを保証するものではありません</strong>。
              各事業者(主催者)の責任で、実態に合わせて必ず書き換えてください。
              不明な点は専門家にご確認ください。
            </p>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-bold">
              テンプレが押さえている項目(概要)
            </summary>
            <ul className="mt-2 space-y-1 text-sm">
              {tokushohoFields.map((f) => (
                <li key={f.key} className="border-b border-rule pb-1">
                  <span className="font-bold">{f.label}</span>
                  <span className="ml-2 text-neutral">— {f.hint}</span>
                </li>
              ))}
            </ul>
          </details>

          <form
            method="post"
            action={`/g/${handle}/settings/tokushoho`}
            className="mt-4 space-y-4"
          >
            {tokushohoFields.map((f) => (
              <label key={f.key} className="block">
                <span className="text-sm font-bold">{f.label}</span>
                {f.multiline ? (
                  <textarea
                    name={f.key}
                    rows={2}
                    defaultValue={tokushohoValues[f.key]}
                    className="input mt-1 leading-relaxed"
                  />
                ) : (
                  <input
                    type="text"
                    name={f.key}
                    defaultValue={tokushohoValues[f.key]}
                    className="input mt-1"
                  />
                )}
              </label>
            ))}
            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" className="btn cursor-pointer">
                保存
              </button>
              {group.tokushoho && (
                <Link to={`/g/${handle}/legal/tokushoho`} className="link text-sm">
                  公開ページを見る
                </Link>
              )}
            </div>
          </form>
        </section>
      )}

      {/* ---- Bluesky クロスポスト ---- */}
      {canSettings && (
        <section id="bluesky" className="mt-10 scroll-mt-4">
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
        <section id="members" className="mt-10 scroll-mt-4">
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

          {group.isPersonal ? (
            <p className="mt-4 border-2 border-rule bg-paper-2 p-3 text-sm text-neutral">
              個人グループは、あなた1人のためのグループです。他のメンバーは追加できません。
              仲間と共同で運営したい場合は、
              <Link to="/groups/new" className="link">
                共用グループを新しく作成
              </Link>
              してください。
            </p>
          ) : (
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
          )}
        </section>
      )}

      {/* ---- 参加者ブロック ---- */}
      {canMembers && (
        <section id="blocks" className="mt-10 scroll-mt-4">
          <h2 className="display border-b-2 border-ink pb-2 t-md">
            参加者ブロック
            <HelpTip text="ブロックした相手は、このグループのイベントへ申し込めなくなります。Fediverse 連携済みのアカウントには本人・連携先の双方に効きます。" />
          </h2>
          <p className="mt-2 text-sm text-neutral">
            ブロックした相手は、このグループのイベントに参加申込できなくなります。
            既存の参加はここでは取り消されません(必要なら各イベントの管理画面で対応してください)。
          </p>

          {blockError && (
            <p role="alert" className="mt-3 border-2 border-accent p-3 text-sm text-accent">
              {blockError}
            </p>
          )}

          {blocks.length > 0 ? (
            <ul className="mt-4">
              {blocks.map((b) => (
                <li
                  key={b.blockedActorId}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-rule py-3"
                >
                  <div className="min-w-0">
                    <span className="font-bold">{b.displayName}</span>
                    {b.handle && (
                      <span className="meta-mono ml-2 text-sm text-neutral">
                        @{b.handle}
                        {b.domain && b.domain !== 'bsky' ? `@${b.domain}` : ''}
                        {b.domain === 'bsky' ? ' (Bluesky)' : ''}
                      </span>
                    )}
                    {b.reason && <p className="mt-0.5 text-sm text-neutral">理由: {b.reason}</p>}
                  </div>
                  <form method="post" action={`/g/${handle}/blocks/remove`}>
                    <input type="hidden" name="blocked_actor_id" value={b.blockedActorId} />
                    <button
                      type="submit"
                      className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-ink"
                    >
                      解除
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-neutral">ブロック中のアカウントはありません。</p>
          )}

          <details className="mt-4 border-2 border-ink">
            <summary className="cursor-pointer p-3 text-sm font-bold">
              ハンドルでブロックを追加
            </summary>
            <form
              method="post"
              action={`/g/${handle}/blocks`}
              className="flex flex-wrap items-end gap-3 border-t-2 border-ink p-4"
            >
              <label className="block min-w-48 flex-1">
                <span className="text-sm font-bold">ハンドル(このインスタンスのユーザー)</span>
                <input
                  type="text"
                  name="handle"
                  required
                  className="input meta-mono mt-1"
                  placeholder="@kyoto-taro"
                />
              </label>
              <label className="block min-w-48 flex-1">
                <span className="text-sm font-bold">理由(任意・記録用)</span>
                <input type="text" name="reason" className="input mt-1" />
              </label>
              <button type="submit" className="btn cursor-pointer">
                ブロック
              </button>
            </form>
            <p className="border-t border-rule px-4 py-3 text-sm text-neutral">
              Fediverse からの参加者は、各イベントの管理画面の参加者一覧からブロックできます。
            </p>
          </details>
        </section>
      )}

      {/* ---- ロール管理 ---- */}
      {canSettings && (
        <section id="roles" className="mt-10 scroll-mt-4">
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
        </SectionNavLayout>
      </div>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
