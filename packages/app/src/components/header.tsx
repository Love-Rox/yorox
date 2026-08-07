import { Link } from 'waku';
import { getCurrentUser } from '../server/current-user';

export const Header = async () => {
  const user = await getCurrentUser();

  return (
    <header className="flex w-full items-center justify-between gap-4 p-6 lg:fixed lg:left-0 lg:top-0">
      <h2 className="text-lg font-bold tracking-tight">
        <Link to="/">Yorox</Link>
      </h2>
      <nav className="flex items-center gap-4 text-sm">
        {user ? (
          <>
            {user.handle && (
              <Link to={`/g/${user.handle}`} className="underline">
                {user.displayName}
              </Link>
            )}
            <form method="post" action="/auth/logout">
              <button type="submit" className="text-gray-500 underline">
                ログアウト
              </button>
            </form>
          </>
        ) : (
          <Link to="/login" className="underline">
            ログイン
          </Link>
        )}
      </nav>
    </header>
  );
};
