'use client';
/**
 * ボタンで開閉するドロップダウン(WAI-ARIA の disclosure パターン)。
 *
 * あえて role="menu" は使わない。menu/menuitem は矢印キーでの項目移動を伴う
 * アプリ的メニュー用で、ここは「リンク/操作を数個並べる」だけなので、
 * 素の <a>/<button> を通常のタブ順で辿れる disclosure が適切かつ正直。
 *
 * a11y:
 * - トリガーは <button aria-expanded aria-controls>
 * - 外側クリック(pointerdown)/ Escape / フォーカスが外へ出たら閉じる
 * - Escape で閉じたらフォーカスをトリガーへ戻す
 * - 別のメニューを開く=このメニューの外側クリックなので、同時に複数開かない
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function Menu({
  label,
  children,
  align = 'left',
  variant = 'button',
}: {
  label: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  /** ghost: 枠なし(ヘッダーのアカウントメニュー用) */
  variant?: 'button' | 'ghost';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) =>
      !!rootRef.current && !rootRef.current.contains(target as Node | null);
    const onDown = (e: PointerEvent) => {
      if (outside(e.target)) setOpen(false);
    };
    // Tab などでフォーカスがメニューの外へ移ったら閉じる(キーボード操作対応)。
    // focusin は document までバブリングするため relatedTarget に依存せず確実
    const onFocusIn = (e: FocusEvent) => {
      if (outside(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={
          variant === 'ghost'
            ? 'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-ui px-2 hover:bg-paper-2'
            : 'btn-quiet cursor-pointer gap-1'
        }
      >
        {label}
        <span aria-hidden="true" className="text-xs">
          ▾
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          onClick={() => setOpen(false)}
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} z-20 mt-1 min-w-56 overflow-hidden rounded-ui-lg border border-rule-strong bg-surface p-1 shadow-[0_10px_30px_-12px_color-mix(in_oklch,var(--yorox-ink)_45%,transparent)] [&_a]:rounded-ui [&_button]:rounded-ui`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
