/**
 * Yorox のロゴ。上版はテーマのインク色、下版はアクセント(版ズレ)を
 * CSS 変数で参照するため、ライト/ダークに自動追従する。
 */

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden>
      <rect width="512" height="512" rx="104" fill="var(--yorox-ink)" />
      <path
        d="M146 128 L256 262 M366 128 L256 262 M256 262 L256 396"
        fill="none"
        stroke="var(--yorox-accent)"
        strokeWidth="92"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(-12,-9)"
      />
      <path
        d="M146 128 L256 262 M366 128 L256 262 M256 262 L256 396"
        fill="none"
        stroke="var(--yorox-paper)"
        strokeWidth="92"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(8,8)"
      />
    </svg>
  );
}

export function Wordmark({ height = 30 }: { height?: number }) {
  const width = (height / 120) * 348;
  return (
    <svg viewBox="0 0 348 120" width={width} height={height} role="img" aria-label="Yorox">
      <defs>
        <g
          id="yorox-word"
          fill="none"
          strokeWidth="24"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 14 L44 50 M72 14 L44 50 M44 50 L44 102" />
          <circle cx="115" cy="75" r="27" />
          <path d="M166 52 L166 102 M166 78 Q166 52 196 54" />
          <circle cx="243" cy="75" r="27" />
          <path d="M296 52 L332 102 M332 52 L296 102" />
        </g>
      </defs>
      <use href="#yorox-word" stroke="var(--yorox-accent)" transform="translate(-4,-3)" />
      <use href="#yorox-word" stroke="var(--yorox-ink)" transform="translate(2.5,2.5)" />
    </svg>
  );
}
