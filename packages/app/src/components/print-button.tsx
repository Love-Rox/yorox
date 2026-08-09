'use client';
/** 印刷ダイアログを開くボタン(印刷時は自身を隠す) */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn no-print cursor-pointer">
      印刷する
    </button>
  );
}
