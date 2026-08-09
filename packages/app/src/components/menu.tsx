'use client';
/**
 * ボタンで開閉するドロップダウンメニュー。
 * - 外側クリック / Escape で閉じる
 * - 別のメニューを開くと(=このメニューの外側をクリックすると)自動的に閉じるので、
 *   同時に複数が開かない
 * 中身は素の <a> / <form> を children で渡す(サーバー側でレンダリング可能)。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Menu({
  label,
  children,
  align = 'left',
}: {
  label: string;
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="btn-quiet inline-flex cursor-pointer items-center gap-1"
      >
        {label}
        <span aria-hidden="true" className="text-xs">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} z-10 mt-1 min-w-56 border-2 border-ink bg-paper p-1 shadow-[var(--yorox-offset-shadow)]`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
