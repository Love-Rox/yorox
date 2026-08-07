import '../styles.css';

import type { ReactNode } from 'react';
import { Footer } from '../components/footer';
import { Header } from '../components/header';

type RootLayoutProps = { children: ReactNode };

export default async function RootLayout({ children }: RootLayoutProps) {
  return (
    <div className="flex min-h-svh flex-col">
      <meta name="description" content="分散型で運用できるイベント管理プラットフォーム" />
      <link rel="icon" type="image/png" href="/images/favicon.png" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Zen+Kaku+Gothic+New:wght@400;700&family=Space+Mono:wght@400;700&display=swap"
        precedence="font"
      />
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-[clamp(1rem,4vw,1.5rem)] py-10">
        {children}
      </main>
      <Footer />
    </div>
  );
}

export const getConfig = async () => {
  return {
    // ヘッダがログイン状態を表示するためリクエスト毎に描画する
    render: 'dynamic',
  } as const;
};
