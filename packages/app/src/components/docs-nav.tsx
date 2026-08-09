/**
 * ドキュメントのサイドバーナビ。
 * 広い画面では固定サイドバー、狭い画面ではコンテンツ上部に畳んで表示する
 * (docs/_layout.tsx から使う)。現在ページはハイライトする。
 */
import { Link } from 'waku';
import { GUIDE_STEPS } from './selfhost-guide';

const SECTIONS: { href: string; title: string }[] = [
  { href: '/docs', title: '使い方' },
  { href: '/docs/faq', title: 'よくある質問' },
  { href: '/docs/participants', title: '参加者向け' },
  { href: '/docs/organizers', title: '主催者向け' },
  { href: '/docs/federation', title: '分散型のしくみ' },
  { href: '/docs/instance-owners', title: 'サイトオーナー向け' },
];

function NavLink({
  href,
  title,
  active,
  indent,
}: {
  href: string;
  title: string;
  active: boolean;
  indent?: boolean;
}) {
  const base = `block rounded px-3 py-1.5 text-sm ${indent ? 'pl-6' : ''}`;
  return active ? (
    <span
      aria-current="page"
      className={`${base} border-l-2 border-accent bg-paper-2 font-bold text-ink`}
    >
      {title}
    </span>
  ) : (
    <Link to={href} className={`${base} border-l-2 border-transparent text-neutral hover:text-ink hover:bg-paper-2`}>
      {title}
    </Link>
  );
}

function NavList({ pathname, guideEnabled }: { pathname: string; guideEnabled: boolean }) {
  const selfHostingActive = pathname.startsWith('/docs/self-hosting');
  return (
    <ul className="space-y-0.5">
      {SECTIONS.map((s) => (
        <li key={s.href}>
          <NavLink href={s.href} title={s.title} active={pathname === s.href} />
        </li>
      ))}
      {guideEnabled && (
        <li>
          <NavLink
            href="/docs/self-hosting"
            title="自分のサーバーで運営する"
            active={pathname === '/docs/self-hosting'}
          />
          {selfHostingActive && (
            <ul className="mt-0.5 space-y-0.5">
              {GUIDE_STEPS.filter((s) => s.slug).map((s) => {
                const href = `/docs/self-hosting/${s.slug}`;
                return (
                  <li key={s.slug}>
                    <NavLink href={href} title={s.title} active={pathname === href} indent />
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      )}
    </ul>
  );
}

export function DocsNav({
  pathname,
  guideEnabled,
}: {
  pathname: string;
  guideEnabled: boolean;
}) {
  return (
    <>
      {/* 広い画面: 固定サイドバー */}
      <nav aria-label="ドキュメント" className="hidden lg:block">
        <p className="px-3 pb-2 text-xs font-bold tracking-wide text-neutral">ドキュメント</p>
        <NavList pathname={pathname} guideEnabled={guideEnabled} />
      </nav>
      {/* 狭い画面: 畳める目次 */}
      <details className="border-2 border-ink lg:hidden">
        <summary className="cursor-pointer px-3 py-2 text-sm font-bold">
          ドキュメント目次
        </summary>
        <div className="border-t-2 border-ink p-2">
          <NavList pathname={pathname} guideEnabled={guideEnabled} />
        </div>
      </details>
    </>
  );
}
