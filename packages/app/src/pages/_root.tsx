import type { ReactNode } from 'react';
import { ErrorBoundary } from 'waku/router/client';

/**
 * ルート要素。<html lang="ja"> を出すためにデフォルトを上書きする。
 * Waku のデフォルトルート要素にはルートのエラーバウンダリが含まれるため、
 * 上書き時は自前で ErrorBoundary を包む必要がある(README「Root element」)。
 */
export default async function RootElement({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <html lang="ja">
        <head></head>
        <body>{children}</body>
      </html>
    </ErrorBoundary>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
