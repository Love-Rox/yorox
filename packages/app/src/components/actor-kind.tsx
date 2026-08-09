/**
 * アクターの種別(グループ / 個人)を示すロゴ調のアイコン・バッジ。
 *
 * ロゴ(components/logo.tsx)の「角丸タイル」を踏襲し、
 * 個人 = 1人・グループ = 複数人のグリフで区別する。色はテーマ変数を参照し
 * ライト/ダークに追従する。
 *
 * 判定: 個人グループ(isPersonal)はユーザー本人と同じ実体なので「個人」扱い。
 * 「グループ」と表示するのは kind='group' かつ isPersonal でないものだけ。
 */

export function isCommunityGroup(kind: 'user' | 'group', isPersonal?: boolean | null): boolean {
  return kind === 'group' && !isPersonal;
}

/**
 * 種別を3値で表す。
 * - user           … 本人プロフィール(/u/…)   → 中間色タイル・1人・「個人」
 * - personal group … 個人の主催ページ(/g/…)  → 青タイル・1人・「個人グループ」
 * - community group… 共用グループ(/g/…)       → 青タイル・2人・「グループ」
 * タイル色で「グループ実体 or 本人プロフィール」、グリフ人数で「共用 or 個人」を表す。
 */
function kindMeta(kind: 'user' | 'group', isPersonal?: boolean | null) {
  const isGroup = kind === 'group';
  const community = isGroup && !isPersonal;
  return {
    label: community ? 'グループ' : isGroup ? '個人グループ' : '個人',
    tile: isGroup ? 'var(--yorox-accent-2)' : 'var(--yorox-neutral)',
    twoPeople: community,
  };
}

/** 角丸タイルに種別グリフを描くアイコン(単体) */
export function ActorKindMark({
  kind,
  isPersonal,
  size = 16,
  className,
}: {
  kind: 'user' | 'group';
  isPersonal?: boolean | null | undefined;
  size?: number;
  className?: string;
}) {
  const { label, tile, twoPeople } = kindMeta(kind, isPersonal);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={className}
    >
      <title>{label}</title>
      <rect width="24" height="24" rx="6" fill={tile} />
      <g fill="var(--yorox-paper)">
        {twoPeople ? (
          // 2人(前後に重ねた頭+肩)
          <>
            <circle cx="8.5" cy="9" r="2.6" />
            <path d="M4 18c0-2.5 2-4.2 4.5-4.2S13 15.5 13 18z" />
            <circle cx="15.5" cy="9.5" r="2.4" />
            <path d="M12.4 18c.2-2.2 1.7-3.9 3.9-3.9 2.4 0 4 1.7 4 4.2z" />
          </>
        ) : (
          // 1人(頭+肩)
          <>
            <circle cx="12" cy="8.5" r="3.1" />
            <path d="M5.8 18.2c0-3 2.8-5 6.2-5s6.2 2 6.2 5z" />
          </>
        )}
      </g>
    </svg>
  );
}

/** アイコン + ラベルテキストのピル(見出し用) */
export function ActorKindBadge({
  kind,
  isPersonal,
  className,
}: {
  kind: 'user' | 'group';
  isPersonal?: boolean | null | undefined;
  className?: string;
}) {
  const { label } = kindMeta(kind, isPersonal);
  return (
    <span
      className={`inline-flex items-center gap-1 border border-rule px-2 py-0.5 text-sm text-neutral ${className ?? ''}`}
    >
      <ActorKindMark kind={kind} isPersonal={isPersonal} size={14} />
      {label}
    </span>
  );
}
