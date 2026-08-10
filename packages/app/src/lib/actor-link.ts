/**
 * アクターのプロフィールへのリンク先を決める。
 *
 * 連携(claim)済みのリモートアカウントは自インスタンスのプロフィールを持つので
 * そちらを優先し、未連携のリモートは本人のサーバーへ送る。
 * 参加者一覧・管理コンソールなど複数の画面で同じ判定が要るためここに集約する。
 */
export interface ActorLinkSource {
  handle?: string | null | undefined;
  domain?: string | null | undefined;
  uri?: string | null | undefined;
  /** claim 済みリモートの場合、紐付いたローカルアカウントの handle */
  claimedHandle?: string | null | undefined;
}

export type ActorLink =
  /** 自インスタンスのプロフィール(Link で遷移) */
  | { kind: 'local'; href: string }
  /** 他サーバーのプロフィール(別タブで開く) */
  | { kind: 'remote'; href: string }
  /** リンク先が無い(未連携でハンドルも URI も無いリモート等) */
  | { kind: 'none' };

export function actorLink(actor: ActorLinkSource): ActorLink {
  if (actor.domain) {
    if (actor.claimedHandle) return { kind: 'local', href: `/u/${actor.claimedHandle}` };
    return actor.uri ? { kind: 'remote', href: actor.uri } : { kind: 'none' };
  }
  return actor.handle ? { kind: 'local', href: `/u/${actor.handle}` } : { kind: 'none' };
}
