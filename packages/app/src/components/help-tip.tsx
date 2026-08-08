/**
 * ヘルプアイコン(?)。ホバー / フォーカス / タップで説明をポップ表示する。
 * CSS のみで動く(styles.css の .helptip 群)。
 */
export function HelpTip({ text }: { text: string }) {
  return (
    <span className="helptip">
      <span tabIndex={0} role="note" aria-label={`ヘルプ: ${text}`} className="helptip__icon">
        ?
      </span>
      <span aria-hidden className="helptip__body">
        {text}
      </span>
    </span>
  );
}
