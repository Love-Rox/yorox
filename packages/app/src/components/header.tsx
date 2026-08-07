import { Link } from 'waku';
import { getCurrentUser } from '../server/current-user';

/**
 * N6 Newspaper masthead — 中央の大きなワードマーク + 下に issue 行、
 * 二重罫線(ピンク+青の版ズレ)で締める。
 */
export const Header = async () => {
  const user = await getCurrentUser();

  return (
    <header className="w-full">
      <div className="mx-auto w-full max-w-3xl px-[clamp(1rem,4vw,1.5rem)] pt-8 pb-4">
        <div className="flex items-end justify-between gap-4">
          <h1 className="display t-2xl leading-none">
            <Link to="/">Yorox</Link>
          </h1>
          <nav className="flex min-h-11 items-center gap-4 text-sm">
            {user ? (
              <>
                {user.handle && (
                  <Link to={`/g/${user.handle}`} className="link">
                    {user.displayName}
                  </Link>
                )}
                <form method="post" action="/auth/logout" className="flex items-center">
                  <button
                    type="submit"
                    className="min-h-11 cursor-pointer text-neutral underline underline-offset-3 hover:text-ink"
                  >
                    ログアウト
                  </button>
                </form>
              </>
            ) : (
              <Link to="/login" className="link flex min-h-11 items-center">
                ログイン
              </Link>
            )}
          </nav>
        </div>
        <p className="meta-mono mt-2 text-sm text-neutral">
          自分たちで運営する、イベントの寄合所
        </p>
      </div>
      <hr className="rule-duo" />
    </header>
  );
};
