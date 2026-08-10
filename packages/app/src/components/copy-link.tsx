'use client';
/**
 * 短縮リンクなどをワンクリックでコピーするボタン。
 * クリップボード API が使えない環境ではテキスト選択にフォールバックする。
 */
import { useRef, useState } from 'react';

export function CopyLink({ url, label = '短縮リンク' }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // 権限が無い/HTTP などクリップボードが使えない場合は選択状態にする
      inputRef.current?.select();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        readOnly
        value={url}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="input meta-mono min-h-0 w-full max-w-xs py-1 text-sm"
      />
      <button type="button" onClick={copy} className="btn-quiet cursor-pointer text-sm">
        {copied ? 'コピーしました' : 'コピー'}
      </button>
    </span>
  );
}
