'use client';
/**
 * OS ネイティブの共有シート(Web Share API)を開くボタン。
 * 対応していないブラウザでは何も表示しない(SNS リンクが別途あるため)。
 */
import { useEffect, useState } from 'react';

export function ShareNative({ title, url }: { title: string; url: string }) {
  const [supported, setSupported] = useState(false);

  // SSR とハイドレーション不一致を避けるため、マウント後に判定する
  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => {
        navigator.share({ title, url }).catch(() => undefined);
      }}
      className="block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
    >
      端末の共有メニューを開く
    </button>
  );
}
