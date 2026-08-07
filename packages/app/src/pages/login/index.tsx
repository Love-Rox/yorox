import { unstable_getRequest as getRequest } from 'waku/router/server';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: 'メールアドレスの形式が正しくありません。',
  invalid_token: 'リンクが正しくありません。',
  expired: 'リンクの有効期限が切れています。もう一度お試しください。',
  conflict: '登録中に競合が発生しました。もう一度お試しください。',
};

export default async function LoginPage() {
  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');

  return (
    <div className="w-full max-w-sm">
      <title>ログイン - Yorox</title>
      <h1 className="text-3xl font-bold tracking-tight">ログイン</h1>
      <p className="mt-2 text-sm text-gray-600">
        メールアドレスにログインリンクを送ります。アカウントがなければ、そのまま新規登録に進めます。
      </p>
      {error && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {ERROR_MESSAGES[error] ?? 'エラーが発生しました。'}
        </p>
      )}
      <form method="post" action="/auth/magic-link/request" className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">メールアドレス</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="you@example.com"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded bg-black px-4 py-2 font-medium text-white"
        >
          ログインリンクを送る
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
