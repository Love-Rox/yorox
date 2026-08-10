'use client';
/**
 * 送信中の状態を表示する submit ボタン。
 * 外部 API を叩く操作(Discord テスト送信など)で、押したあと何も起きていない
 * ように見えるのを防ぐ。二重送信も抑止する。
 */
import { useState } from 'react';

export function SubmitButton({
  children,
  pendingLabel = '送信中…',
  className = 'btn-quiet cursor-pointer text-sm',
}: {
  children: string;
  pendingLabel?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={() => setPending(true)}
      className={`${className} disabled:cursor-progress disabled:opacity-60`}
      aria-busy={pending}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
