import { unstable_getRequest as getRequest } from 'waku/router/server';
import { unstable_redirect as redirect } from 'waku/router/server';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: 'ハンドルは英小文字・数字・ハイフン(1〜40文字)、表示名は必須です。',
  handle_taken: 'このハンドルは既に使われています。',
};

export default async function OnboardingPage() {
  const url = new URL(getRequest().url);
  const ticket = url.searchParams.get('ticket');
  if (!ticket) return redirect('/login');
  const error = url.searchParams.get('error');

  return (
    <div className="max-w-sm">
      <title>アカウント作成 - Yorox</title>
      <h1 className="display t-xl">アカウント作成</h1>
      <p className="mt-3 text-sm text-neutral">
        メールアドレスを確認しました。ハンドルと表示名を決めてください。
        同じハンドルであなたの個人グループも作成されます。
      </p>
      {error && (
        <p
          role="alert"
          className="mt-4 border-2 border-accent p-3 text-sm text-accent"
        >
          {ERROR_MESSAGES[error] ?? 'エラーが発生しました。'}
        </p>
      )}
      <form method="post" action="/auth/signup" className="mt-6 space-y-5">
        <input type="hidden" name="ticket" value={ticket} />
        <label className="block">
          <span className="text-sm font-bold">ハンドル</span>
          <input
            type="text"
            name="handle"
            required
            pattern="[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?"
            className="input meta-mono mt-1"
            placeholder="kyoto-taro"
          />
          <span className="mt-1 block text-sm text-neutral">
            英小文字・数字・ハイフン。プロフィール URL(/@ハンドル)になります
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-bold">表示名</span>
          <input
            type="text"
            name="display_name"
            required
            maxLength={80}
            className="input mt-1"
            placeholder="京都 太郎"
          />
        </label>
        <button type="submit" className="btn w-full cursor-pointer">
          登録する
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
