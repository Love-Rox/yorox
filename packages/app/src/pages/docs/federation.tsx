import { Link } from 'waku';

export default async function FederationGuidePage() {
  return (
    <article className="max-w-[70ch]">
      <title>分散型のしくみ - Yorox</title>
      <p className="text-sm">
        <Link to="/docs" className="link">
          ← 使い方
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">分散型のしくみ</h1>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          中央のサービスに頼らない、ということ
        </h2>
        <p className="mt-3">
          Yorox は特定の会社が運営する単一のサービスではありません。誰でも自分の
          Yorox <strong>インスタンス</strong>(サーバー)を建てられ、それぞれが独立に
          動きます。名前の由来である「寄合」— 中央に頼らず自分たちで運営する集まり —
          の思想そのままに、コミュニティが自分たちのイベント基盤を自分たちで
          持てるようにするのが目的です。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          ActivityPub による連合(準備中)
        </h2>
        <p className="mt-3">
          インスタンス同士は、Mastodon や Misskey と同じ
          <strong> ActivityPub</strong> というプロトコルで繋がるよう設計されています。
          将来のバージョンでは次のことができるようになります:
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            他のインスタンスや Fediverse(Mastodon 等)のアカウントから、
            このインスタンスのイベントに参加申込する
          </li>
          <li>グループをフォローして、新しいイベントの告知を自分のタイムラインで受け取る</li>
          <li>
            Fediverse アカウントを Yorox アカウントに紐付ける(claim)ことで、
            どこから参加しても同じ参加履歴として扱う
          </li>
          <li>公開イベントを集約する「アグリゲータ」を誰でも建てられる公開仕様</li>
        </ul>
        <p className="mt-3">
          現在は各インスタンスが単体で動作します。ただし ID や URL
          の設計は初めから連合を前提にしているため、連合機能が有効になっても
          イベントやグループのアドレスは変わりません。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          インスタンスをまたいでも壊れない設計
        </h2>
        <ul className="mt-3 list-inside list-disc space-y-1">
          <li>
            イベント・グループ・ユーザーには変わらない ID(URL)が割り当てられ、
            名前を変えてもリンクは切れません
          </li>
          <li>
            参加者の評判(出欠率)はそのインスタンスの中だけで使われ、
            外部には共有されません
          </li>
          <li>
            モデレーションは各インスタンスの管理者とイベント主催者がそれぞれの
            責任範囲で行います
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">オープンソース</h2>
        <p className="mt-3">
          Yorox のソースコードは{' '}
          <a
            href="https://github.com/Love-Rox/yorox"
            className="link"
            rel="noreferrer"
          >
            GitHub
          </a>{' '}
          で公開されています。自分のインスタンスを建てたい方は
          <Link to="/docs/instance-owners" className="link">
            サイトオーナー向けガイド
          </Link>
          をご覧ください。
        </p>
      </section>
    </article>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
