import { Link } from 'waku';
import { unstable_getRequest as getRequest } from 'waku/router/server';
import { eq } from 'drizzle-orm';
import { Avatar } from '../../components/avatar';
import { HelpTip } from '../../components/help-tip';
import { LoginRequired } from '../../components/login-required';
import { schema } from '../../db/client';
import { getCurrentUser } from '../../server/current-user';
import { listClaimedAliases } from '../../server/claim';
import { getDb } from '../../server/data';
import { getUploadConfig } from '../../storage/driver';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: '表示名は必須です。',
  uploads_disabled: 'このインスタンスではファイルアップロードが無効です。',
  no_file: 'ファイルが選択されていません。',
  too_large: 'ファイルサイズが上限を超えています。',
  bad_type: '対応していない画像形式です(PNG / JPEG / WebP / GIF)。',
};

export default async function ProfileSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return <LoginRequired />;

  const db = await getDb();
  const me = await db.query.actors.findFirst({
    where: eq(schema.actors.id, user.actorId),
  });
  if (!me) return <LoginRequired />;

  const { env } = await import('cloudflare:workers');
  const uploads = getUploadConfig(env);

  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');
  const links = me.profileLinks ?? [];

  const claimCode = url.searchParams.get('claim_code');
  const claimOk = url.searchParams.get('claim_ok');
  const claimError = url.searchParams.get('claim_error');
  const notifySaved = url.searchParams.get('notify_saved');
  const aliases = await listClaimedAliases(db, user.actorId);
  const account = await db.query.users.findFirst({
    where: eq(schema.users.actorId, user.actorId),
  });
  const host = url.host;

  return (
    <div className="max-w-xl">
      <title>プロフィール設定 - Yorox</title>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display t-xl">プロフィール設定</h1>
        {me.handle && (
          <Link to={`/u/${me.handle}`} className="link text-sm">
            公開プロフィールを見る
          </Link>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          {ERROR_MESSAGES[error] ?? 'エラーが発生しました。'}
        </p>
      )}

      {/* ---- アバター ---- */}
      <section className="mt-6 border-2 border-ink p-4">
        <h2 className="text-sm font-bold">アバター</h2>
        <div className="mt-3 flex items-center gap-4">
          <Avatar avatarUrl={me.avatarUrl} displayName={me.displayName} size="lg" />
          {uploads.enabled ? (
            <form
              method="post"
              action="/profile/avatar"
              encType="multipart/form-data"
              className="flex flex-wrap items-center gap-3"
            >
              <input
                type="file"
                name="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                required
                className="text-sm"
              />
              <button type="submit" className="btn-quiet cursor-pointer">
                アップロード
              </button>
            </form>
          ) : (
            <p className="text-sm text-neutral">
              このインスタンスでは画像アップロードが無効です
            </p>
          )}
        </div>
      </section>

      {/* ---- 基本情報 ---- */}
      <form method="post" action="/profile/update" className="mt-6 space-y-5">
        <label className="block">
          <span className="text-sm font-bold">表示名 *</span>
          <input
            type="text"
            name="display_name"
            required
            maxLength={80}
            defaultValue={me.displayName}
            className="input mt-1"
          />
        </label>
        <div className="meta-mono text-sm text-neutral">@{me.handle}(変更不可)</div>
        <label className="block">
          <span className="text-sm font-bold">自己紹介(Markdown)</span>
          <textarea
            name="summary"
            rows={5}
            defaultValue={me.summary ?? ''}
            className="input mt-1 leading-relaxed"
            placeholder={'京都でフロントエンドをやっています。\n好きな技術: …'}
          />
        </label>
        <fieldset>
          <legend className="text-sm font-bold">リンク(最大3つ)</legend>
          <p className="mt-1 text-sm text-neutral">
            X / GitHub / Bluesky / Mastodon などはアイコン付きで表示されます
          </p>
          {[0, 1, 2].map((i) => (
            <input
              key={i}
              type="url"
              name={`link${i + 1}`}
              defaultValue={links[i] ?? ''}
              className="input meta-mono mt-2"
              placeholder={
                i === 0 ? 'https://x.com/…' : i === 1 ? 'https://github.com/…' : 'https://…'
              }
            />
          ))}
        </fieldset>
        <button type="submit" className="btn cursor-pointer">
          保存する
        </button>
      </form>

      {/* ---- お知らせ設定 ---- */}
      <section id="notifications" className="mt-10 scroll-mt-4 border-2 border-ink p-4">
        <h2 className="display t-md">
          お知らせの受け取り
          <HelpTip text="参加確定・補欠繰上・抽選結果などのお知らせの届け方です。オフにしてもログイン用メール(マジックリンク)は届きます。Fediverse 連携アカウントで参加した分は、そのアカウント宛のメンションで届きます。" />
        </h2>
        {notifySaved && (
          <p role="status" className="mt-3 border-2 border-accent-2 p-3 text-sm text-accent-2">
            保存しました。
          </p>
        )}
        <form method="post" action="/profile/notifications" className="mt-3">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="email_notifications"
              defaultChecked={account?.emailNotifications ?? true}
            />
            <span>参加状況のお知らせをメール({account?.email})で受け取る</span>
          </label>
          <button type="submit" className="btn-quiet mt-2 cursor-pointer">
            保存
          </button>
        </form>
      </section>

      {/* ---- Fediverse アカウント連携(claim) ---- */}
      <section id="fediverse" className="mt-10 scroll-mt-4 border-2 border-ink p-4">
        <h2 className="display t-md">Fediverse アカウント連携</h2>
        <p className="mt-2 text-sm text-neutral">
          Misskey / Mastodon などのアカウントを紐付けると、そのアカウントからの
          イベント参加があなたの参加履歴として扱われ、「アカウント連携済みの人」限定の枠にも
          参加できるようになります。
        </p>

        {claimOk && (
          <p role="status" className="mt-3 border-2 border-accent-2 p-3 text-sm text-accent-2">
            連携が完了しました。
          </p>
        )}
        {claimError && (
          <p role="alert" className="mt-3 border-2 border-accent p-3 text-sm text-accent">
            {claimError}
          </p>
        )}

        {aliases.length > 0 && (
          <ul className="mt-4 space-y-2">
            {aliases.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <a href={a.uri} className="link meta-mono text-sm" rel="noreferrer" target="_blank">
                  @{a.handle}@{a.domain}
                </a>
                <form method="post" action="/profile/claim-unlink">
                  <input type="hidden" name="remote_actor_id" value={a.id} />
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
        )}

        <div className="mt-5 space-y-6">
          <div>
            <h3 className="text-sm font-bold">方法1: コードを投稿して連携</h3>
            {claimCode ? (
              <div className="mt-2 border border-rule p-3">
                <p className="text-sm">
                  連携したいアカウントから、次のコードを
                  <span className="meta-mono font-bold"> @{me.handle}@{host} </span>
                  宛のメンション付きで投稿してください(DM でも可、30分有効):
                </p>
                <p className="meta-mono mt-2 t-lg font-bold">{claimCode}</p>
              </div>
            ) : (
              <form method="post" action="/profile/claim-code" className="mt-2">
                <button type="submit" className="btn-quiet cursor-pointer">
                  連携コードを発行
                </button>
              </form>
            )}
          </div>
          <div>
            <h3 className="text-sm font-bold">方法2: プロフィールのリンクで連携(rel=me)</h3>
            <p className="mt-1 text-sm text-neutral">
              リモート側プロフィールのリンク欄(メタデータ)に
              <span className="meta-mono"> https://{host}/u/{me.handle} </span>
              を追加してから、アカウントを入力してください。
            </p>
            <form
              method="post"
              action="/profile/claim-relme"
              className="mt-2 flex flex-wrap gap-2"
            >
              <input
                type="text"
                name="remote_account"
                required
                className="input meta-mono max-w-xs"
                placeholder="@you@misskey.example"
              />
              <button type="submit" className="btn-quiet cursor-pointer">
                確認して連携
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
