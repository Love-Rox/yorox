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
    <div className="w-full max-w-sm">
      <title>アカウント作成 - Yorox</title>
      <h1 className="text-3xl font-bold tracking-tight">アカウント作成</h1>
      <p className="mt-2 text-sm text-gray-600">
        メールアドレスを確認しました。ハンドルと表示名を決めてください。
        同じハンドルであなたの個人グループも作成されます。
      </p>
      {error && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {ERROR_MESSAGES[error] ?? 'エラーが発生しました。'}
        </p>
      )}
      <form method="post" action="/auth/signup" className="mt-6 space-y-4">
        <input type="hidden" name="ticket" value={ticket} />
        <label className="block">
          <span className="text-sm font-medium">ハンドル</span>
          <input
            type="text"
            name="handle"
            required
            pattern="[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?"
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="kyoto-taro"
          />
          <span className="mt-1 block text-xs text-gray-500">
            英小文字・数字・ハイフン。プロフィール URL(/@ハンドル)になります
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-medium">表示名</span>
          <input
            type="text"
            name="display_name"
            required
            maxLength={80}
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="京都 太郎"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded bg-black px-4 py-2 font-medium text-white"
        >
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
