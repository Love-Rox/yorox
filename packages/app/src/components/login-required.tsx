import { Link } from 'waku';

/** 未ログインでアクセスされた認証必須ページの案内 */
export function LoginRequired() {
  return (
    <div className="max-w-sm">
      <title>ログインが必要です - Yorox</title>
      <h1 className="display t-xl">ログインが必要です</h1>
      <p className="mt-3 text-sm text-neutral">
        このページを表示するにはログインしてください。
      </p>
      <p className="mt-6">
        <Link to="/login" className="btn inline-block">
          ログインへ
        </Link>
      </p>
    </div>
  );
}
