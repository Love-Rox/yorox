import { and, eq, sql } from 'drizzle-orm';
import { Link } from 'waku';
import { LogoMark, Wordmark } from './logo';
import { schema } from '../db/client';
import { getCurrentUser } from '../server/current-user';
import { getDb } from '../server/data';

/**
 * N6 Newspaper masthead — 中央の大きなワードマーク + 下に issue 行、
 * 二重罫線(ピンク+青の版ズレ)で締める。
 */
export const Header = async () => {
  const user = await getCurrentUser();
  let pendingRequests = 0;
  if (user) {
    const db = await getDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.actionRequests)
      .where(
        and(
          eq(schema.actionRequests.actorId, user.actorId),
          eq(schema.actionRequests.status, 'pending'),
        ),
      );
    pendingRequests = row?.count ?? 0;
  }

  return (
    <header className="w-full">
      <div className="mx-auto w-full max-w-5xl px-[clamp(1rem,4vw,1.5rem)] pt-8 pb-4">
        <div className="flex items-end justify-between gap-4">
          <h1 className="leading-none">
            <Link to="/" className="flex items-center gap-3">
              <LogoMark size={40} />
              <Wordmark height={30} />
            </Link>
          </h1>
          <nav className="flex min-h-11 items-center gap-4 text-sm">
            <Link to="/docs/faq" className="link flex min-h-11 items-center">
              FAQ
            </Link>
            {user ? (
              <>
                {pendingRequests > 0 && (
                  <Link
                    to="/requests"
                    className="border-2 border-accent px-2 py-1 font-bold text-accent"
                  >
                    要確認 {pendingRequests}
                  </Link>
                )}
                {user.handle && (
                  <Link to={`/u/${user.handle}`} className="link">
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
