'use client';
/**
 * 複数行テキスト(告知文など)をコピーできるボックス。
 * クリップボード API が使えない環境ではテキスト選択にフォールバックする。
 */
import { useRef, useState } from 'react';

export function CopyText({ text, label = 'テキスト' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      areaRef.current?.select();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <textarea
        ref={areaRef}
        readOnly
        value={text}
        aria-label={label}
        rows={7}
        onFocus={(e) => e.currentTarget.select()}
        className="input w-full text-sm leading-relaxed"
      />
      <button type="button" onClick={copy} className="btn-quiet mt-2 cursor-pointer text-sm">
        {copied ? 'コピーしました' : '告知文をコピー'}
      </button>
    </div>
  );
}
