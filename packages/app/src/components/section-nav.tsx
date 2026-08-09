/**
 * 設定系ページ用の「セクション見出しサイドバー」レイアウト。
 * 広い画面では左に各セクションへのアンカーリンクを固定表示、狭い画面では
 * 畳める目次にする。中身(フォーム等)は右の列にそのまま置く。追加 JS 不要。
 */
import type { ReactNode } from 'react';

export interface SectionNavItem {
  /** 対応セクションの id(先頭 # は不要) */
  id: string;
  label: string;
}

function NavLinks({ items }: { items: SectionNavItem[] }) {
  return (
    <ul className="space-y-0.5">
      {items.map((it) => (
        <li key={it.id}>
          <a
            href={`#${it.id}`}
            className="block rounded border-l-2 border-transparent px-3 py-1.5 text-sm text-neutral hover:bg-paper-2 hover:text-ink"
          >
            {it.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SectionNavLayout({
  title,
  items,
  children,
}: {
  title: string;
  items: SectionNavItem[];
  children: ReactNode;
}) {
  return (
    <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
      <div className="mb-6 lg:mb-0 lg:sticky lg:top-8 lg:self-start">
        <nav aria-label={title} className="hidden lg:block">
          <p className="px-3 pb-2 text-xs font-bold tracking-wide text-neutral">{title}</p>
          <NavLinks items={items} />
        </nav>
        <details className="border-2 border-ink lg:hidden">
          <summary className="cursor-pointer px-3 py-2 text-sm font-bold">{title}の項目</summary>
          <div className="border-t-2 border-ink p-2">
            <NavLinks items={items} />
          </div>
        </details>
      </div>
      <div className="min-w-0 max-w-2xl">{children}</div>
    </div>
  );
}
