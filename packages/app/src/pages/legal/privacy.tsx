import {
  instanceInfo,
  LegalNav,
  OperatorNotice,
} from '../../components/legal';

/** プライバシーポリシー(テンプレート。インスタンス運営者が確認・編集する) */
export default async function PrivacyPage() {
  const info = await instanceInfo();
  return (
    <article className="max-w-[70ch]">
      <title>プライバシーポリシー - Yorox</title>
      <h1 className="display t-xl">プライバシーポリシー</h1>
      <LegalNav />
      <OperatorNotice configured={info.configured} />

      <p className="mt-6 text-sm text-neutral">
        {info.operator}(以下「運営者」)は、{info.name} における個人情報を以下のとおり
        取り扱います。
      </p>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">取得する情報</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
          <li>メールアドレス(ログイン・お知らせのため)</li>
          <li>表示名・ハンドル・プロフィール・アバター画像</li>
          <li>イベントの参加・出欠・支払い状況</li>
          <li>アクセスログ等の技術情報</li>
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">利用目的</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
          <li>本サービスの提供・本人確認・お知らせの送信</li>
          <li>イベント運営(主催者への参加者情報の提供を含む)</li>
          <li>不正防止・品質改善</li>
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">第三者提供・連合</h2>
        <p className="mt-2 text-sm leading-relaxed">
          本サービスは ActivityPub による分散型連合に対応します。イベントを公開した場合や
          Fediverse アカウントで参加した場合、<strong>公開情報(表示名・投稿・参加など)は
          他のインスタンスへ送信・表示されます</strong>。出欠率などの評判情報は本インスタンス
          内でのみ利用し、外部には共有しません。決済に Stripe を利用する場合、決済に必要な
          情報が Stripe および主催者の決済アカウントに送信されます。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">保管・削除</h2>
        <p className="mt-2 text-sm leading-relaxed">
          情報は利用目的の達成に必要な期間保管します。アカウントの削除・情報の開示等の
          ご要望は下記までご連絡ください。
        </p>
      </section>

      <p className="mt-8 text-sm text-neutral">お問い合わせ: {info.contact}</p>
    </article>
  );
}

export const getConfig = async () => ({ render: 'dynamic' }) as const;
