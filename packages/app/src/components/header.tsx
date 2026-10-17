import { and, eq, sql } from 'drizzle-orm';
import { Link } from 'waku';
import { LogoMark, Wordmark } from './logo';
import { Avatar } from './avatar';
import { Menu } from './menu';
import { schema } from '../db/client';
import { getCurrentUser } from '../server/current-user';
import { getDb } from '../server/data';

/**
 * ヘッダー — ロゴと操作を1行にまとめ、二重罫線(ピンク+青の版ズレ)で締める。
 * ログイン中はアバター付きのアカウントメニュー、未ログインはログインボタン。
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

  const item = 'block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2';
  return (
    <header className="w-full">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-[clamp(1rem,4vw,1.5rem)] py-3 sm:py-4">
        <Link to="/" className="flex min-w-0 items-center gap-2 sm:gap-3" aria-label="Yorox ホーム">
          <span className="shrink-0 [&>svg]:size-8 sm:[&>svg]:size-9">
            <LogoMark size={36} />
          </span>
          <span className="shrink-0 [&>svg]:h-6 [&>svg]:w-auto sm:[&>svg]:h-7">
            <Wordmark height={28} />
          </span>
          {/* タグラインは広い画面のみ(狭い画面では操作の場所を優先) */}
          <span className="hidden border-l border-rule pl-3 text-sm text-neutral md:inline">
            自分たちで運営する、イベントの寄合所
          </span>
        </Link>
        {/* 狭い画面でも折り返さないよう、ユーザー系はメニューに畳む */}
        <nav aria-label="アカウント" className="flex min-h-11 shrink-0 items-center gap-1 text-sm sm:gap-2">
          {user ? (
            <>
              <Link
                to="/timeline"
                className="hidden min-h-11 items-center rounded-ui px-3 font-bold hover:bg-paper-2 sm:flex"
              >
                タイムライン
              </Link>
              {/* 要確認は見逃せないのでメニューの外に出す */}
              {pendingRequests > 0 && (
                <Link
                  to="/requests"
                  aria-label={`要確認 ${pendingRequests} 件`}
                  className="flex min-h-11 items-center gap-1.5 rounded-ui px-2 font-bold hover:bg-paper-2"
                >
                  <span className="hidden sm:inline">要確認</span>
                  <span className="meta-mono inline-flex min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs leading-6 text-paper">
                    {pendingRequests}
                  </span>
                </Link>
              )}
              <Menu
                variant="ghost"
                align="right"
                label={
                  <>
                    <Avatar avatarUrl={user.avatarUrl} displayName={user.displayName} size="sm" />
                    <span className="hidden max-w-32 truncate font-bold sm:inline">
                      {user.displayName}
                    </span>
                    <span className="sr-only sm:hidden">アカウントメニュー</span>
                  </>
                }
              >
                {user.handle && (
                  <a href={`/u/${user.handle}`} className={item}>
                    プロフィール
                  </a>
                )}
                <a href="/timeline" className={item}>
                  タイムライン
                </a>
                <a href="/settings/profile" className={item}>
                  設定
                </a>
                <a href="/docs/faq" className={item}>
                  FAQ・使い方
                </a>
                {siteAdmin && (
                  <a href="/admin/audit" className={item}>
                    監査ログ
                  </a>
                )}
                <form method="post" action="/auth/logout" className="mt-1 border-t border-rule pt-1">
                  <button
                    type="submit"
                    className={`w-full cursor-pointer text-left text-neutral ${item}`}
                  >
                    ログアウト
                  </button>
                </form>
              </Menu>
            </>
          ) : (
            <>
              <Link to="/docs/faq" className="flex min-h-11 items-center rounded-ui px-3 hover:bg-paper-2">
                FAQ
              </Link>
              <Link to="/login" className="btn-quiet">
                ログイン
              </Link>
            </>
          )}
        </nav>
      </div>
      <hr className="rule-duo" />
    </header>
  );
};
