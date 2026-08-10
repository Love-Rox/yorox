import { and, eq, sql } from 'drizzle-orm';
import { Link } from 'waku';
import { LogoMark, Wordmark } from './logo';
import { Menu } from './menu';
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
  let siteAdmin = false;
  if (user) {
    const db = await getDb();
    const { isSiteAdmin } = await import('../domain/audit');
    siteAdmin = await isSiteAdmin(db, user.actorId);
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
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 leading-none">
            <Link
              to="/"
              className="flex items-center gap-2 sm:gap-3"
              aria-label="Yorox ホーム"
            >
              <span className="shrink-0 [&>svg]:size-8 sm:[&>svg]:size-10">
                <LogoMark size={40} />
              </span>
              <span className="shrink-0 [&>svg]:h-6 [&>svg]:w-auto sm:[&>svg]:h-[30px]">
                <Wordmark height={30} />
              </span>
            </Link>
          </div>
          {/* 狭い画面でも折り返さないよう、ユーザー系はメニューに畳む */}
          <nav className="flex min-h-11 shrink-0 items-center gap-3 text-sm">
            {/* 要確認は見逃せないのでメニューの外に出す(件数のみで幅を取らない) */}
            {user && pendingRequests > 0 && (
              <Link
                to="/requests"
                aria-label={`要確認 ${pendingRequests} 件`}
                className="flex min-h-11 items-center border-2 border-accent px-2 font-bold text-accent"
              >
                <span className="hidden sm:inline">要確認&nbsp;</span>
                {pendingRequests}
              </Link>
            )}
            {user ? (
              <Menu label="メニュー" align="right">
                {user.handle && (
                  <a
                    href={`/u/${user.handle}`}
                    className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                  >
                    {user.displayName}
                  </a>
                )}
                <a
                  href="/settings/profile"
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                >
                  設定
                </a>
                <a
                  href="/docs/faq"
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                >
                  FAQ・使い方
                </a>
                {siteAdmin && (
                  <a
                    href="/admin/audit"
                    className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                  >
                    監査ログ
                  </a>
                )}
                <form method="post" action="/auth/logout" className="border-t border-rule">
                  <button
                    type="submit"
                    className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-neutral hover:bg-paper-2 focus-visible:bg-paper-2"
                  >
                    ログアウト
                  </button>
                </form>
              </Menu>
            ) : (
              <>
                <Link to="/docs/faq" className="link flex min-h-11 items-center">
                  FAQ
                </Link>
                <Link to="/login" className="link flex min-h-11 items-center">
                  ログイン
                </Link>
              </>
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
