/**
 * ドキュメント配下(/docs/*)の共通レイアウト。
 * 広い画面ではサイドバーナビ + 本文の2カラム、狭い画面では畳める目次 + 本文。
 * 本文の可読幅(70ch)は各ページ側で維持しつつ、空いていた横幅をナビに使う。
 */
import type { ReactNode } from 'react';
import { unstable_getRequest as getRequest } from 'waku/router/server';
import { DocsNav } from '../../components/docs-nav';
import { isGuideEnabled } from '../../components/selfhost-guide';

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const pathname = new URL(getRequest().url).pathname.replace(/\/$/, '') || '/docs';
  const guideEnabled = await isGuideEnabled();
  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <div className="mb-8 lg:mb-0 lg:sticky lg:top-8 lg:self-start">
        <DocsNav pathname={pathname} guideEnabled={guideEnabled} />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
