import { unstable_getRequest as getRequest } from 'waku/router/server';
import { LoginRequired } from '../../components/login-required';
import { getCurrentUser } from '../../server/current-user';

export default async function NewGroupPage() {
  const user = await getCurrentUser();
  if (!user) return <LoginRequired />;

  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');

  return (
    <div className="max-w-xl">
      <title>グループ作成 - Yorox</title>
      <h1 className="display t-xl">グループ作成</h1>
      <p className="mt-2 text-sm text-neutral">
        イベントはグループから開催します。あなたがオーナーになり、あとから運営メンバーを追加できます。
      </p>
      {error && (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          {decodeURIComponent(error)}
        </p>
      )}
      <form method="post" action="/groups" className="mt-6 space-y-5">
        <label className="block">
          <span className="text-sm font-bold">ハンドル *</span>
          <input
            type="text"
            name="handle"
            required
            pattern="[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?"
            className="input meta-mono mt-1"
            placeholder="kyoto-tech"
          />
          <span className="mt-1 block text-sm text-neutral">
            英小文字・数字・ハイフン。グループ URL(/g/ハンドル)になります。変更不可
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-bold">グループ名 *</span>
          <input
            type="text"
            name="display_name"
            required
            maxLength={80}
            className="input mt-1"
            placeholder="Kyoto Tech Meetup"
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold">紹介文(Markdown)</span>
          <textarea name="description_md" rows={5} className="input mt-1 leading-relaxed" />
        </label>
        <button type="submit" className="btn cursor-pointer">
          グループを作成
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
