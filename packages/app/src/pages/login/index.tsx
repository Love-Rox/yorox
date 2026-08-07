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
    <div className="max-w-sm">
      <title>ログイン - Yorox</title>
      <h1 className="display t-xl">ログイン</h1>
      <p className="mt-3 text-sm text-neutral">
        メールアドレスにログインリンクを送ります。アカウントがなければ、そのまま新規登録に進めます。
      </p>
      {error && (
        <p
          role="alert"
          className="mt-4 border-2 border-accent p-3 text-sm text-accent"
        >
          {ERROR_MESSAGES[error] ?? 'エラーが発生しました。'}
        </p>
      )}
      <form method="post" action="/auth/magic-link/request" className="mt-6 space-y-5">
        <label className="block">
          <span className="text-sm font-bold">メールアドレス</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="input mt-1"
            placeholder="you@example.com"
          />
        </label>
        <button type="submit" className="btn w-full cursor-pointer">
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
