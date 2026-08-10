/**
 * ハッシュタグの正規化と共有文面の組み立て。
 * 保存は「# なし」の配列。表示・共有時に # を付ける。
 */

/** タグとして使えない文字(空白・記号)を除いた1語にする */
function normalizeTag(raw: string): string | null {
  const t = raw
    .trim()
    .replace(/^[#＃]+/, '')
    // 空白と代表的な記号を除去(CJK はそのまま活かす)
    .replace(/[\s,、。!！?？"'`|\\/(){}\[\]<>:;]+/g, '');
  if (!t) return null;
  return t.slice(0, 40);
}

/**
 * 入力欄の文字列(空白・カンマ・改行区切り、# 有無どちらでも)を配列に正規化する。
 * 重複は除き、最大 5 個まで。
 */
export function parseHashtags(input: string): string[] {
  const parts = input.split(/[\s,、\n]+/);
  const out: string[] = [];
  for (const p of parts) {
    const t = normalizeTag(p);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

/** イベントのタグ(未設定ならグループ既定)を解決する */
export function resolveHashtags(
  eventTags: string[] | null | undefined,
  groupTags: string[] | null | undefined,
): string[] {
  if (eventTags && eventTags.length > 0) return eventTags;
  return groupTags ?? [];
}

/** 表示・共有用に "#tag #tag" 形式にする */
export function formatHashtags(tags: string[]): string {
  return tags.map((t) => `#${t}`).join(' ');
}

/** SNS 共有のテキスト(タイトル + タグ) */
export function shareText(title: string, tags: string[]): string {
  const tagLine = formatHashtags(tags);
  return tagLine ? `${title} ${tagLine}` : title;
}
