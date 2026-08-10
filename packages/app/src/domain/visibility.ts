/**
 * イベントの公開範囲(visibility)の判定を一箇所に集約する。
 *
 * - draft    … 下書き。主催メンバーのみ閲覧可
 * - unlisted … 限定公開。URL を知っていれば閲覧・申込できるが、
 *              一覧・検索・sitemap・ActivityPub 告知には出さない
 * - public   … 公開。すべてに流通する
 */
export type Visibility = 'draft' | 'unlisted' | 'public';

/** URL を知っていれば閲覧できるか(unlisted を含む) */
export function isViewable(v: string): boolean {
  return v === 'public' || v === 'unlisted';
}

/** 一覧・検索・sitemap・連合告知に載せてよいか(public のみ) */
export function isListed(v: string): boolean {
  return v === 'public';
}

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  draft: '下書き',
  unlisted: '限定公開',
  public: '公開',
};
