/**
 * 表示名のカスタム絵文字対応。
 * Misskey / Mastodon の名前に含まれる :shortcode: を、アクター文書の
 * Emoji タグから取り込んだ画像(actors.emojis)に置き換えて表示する。
 */
const SHORTCODE_RE = /(:[a-zA-Z0-9_+-]+:)/;

export function ActorName({
  name,
  emojis,
}: {
  name: string;
  emojis?: Record<string, string> | null;
}) {
  if (!emojis || Object.keys(emojis).length === 0) return <>{name}</>;
  const parts = name.split(SHORTCODE_RE);
  return (
    <>
      {parts.map((part, i) => {
        const code = part.startsWith(':') && part.endsWith(':') ? part.slice(1, -1) : null;
        const url = code ? emojis[code] : undefined;
        if (!url) return part;
        return (
          <img
            key={i}
            src={url}
            alt={part}
            title={part}
            referrerPolicy="no-referrer"
            className="inline-block h-[1.25em] w-auto align-text-bottom"
          />
        );
      })}
    </>
  );
}
