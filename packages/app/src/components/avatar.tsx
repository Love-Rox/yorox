/**
 * アバター表示。画像がなければイニシャル(表示名の頭文字)をリソ風の色面で描く。
 */
const SIZES = {
  sm: 'size-6 text-xs',
  md: 'size-10 text-base',
  lg: 'size-20 t-lg',
} as const;

export function Avatar({
  avatarUrl,
  displayName,
  size = 'md',
}: {
  avatarUrl: string | null;
  displayName: string;
  size?: keyof typeof SIZES;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        // リモート画像サーバーのホットリンク保護(Referer 判定)を避ける
        referrerPolicy="no-referrer"
        className={`${SIZES[size]} shrink-0 rounded-full border border-rule object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${SIZES[size]} display flex shrink-0 items-center justify-center rounded-full bg-accent-2 leading-none text-paper`}
    >
      {displayName.slice(0, 1)}
    </span>
  );
}
