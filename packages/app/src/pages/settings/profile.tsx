import { Link } from 'waku';
import { unstable_getRequest as getRequest } from 'waku/router/server';
import { eq } from 'drizzle-orm';
import { Avatar } from '../../components/avatar';
import { LoginRequired } from '../../components/login-required';
import { schema } from '../../db/client';
import { getCurrentUser } from '../../server/current-user';
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
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
