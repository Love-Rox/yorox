import {
  ContactValue,
  instanceInfo,
  LegalNav,
  OperatorNotice,
} from '../../components/legal';

/** 利用規約(テンプレート。インスタンス運営者が確認・編集する) */
export default async function TermsPage() {
  const info = await instanceInfo();
  return (
    <article className="max-w-[70ch]">
      <title>利用規約 - Yorox</title>
      <h1 className="display t-xl">利用規約</h1>
      <LegalNav />
      <OperatorNotice configured={info.configured} />

      <p className="mt-6 text-sm text-neutral">
        本規約は、{info.operator}(以下「運営者」)が提供する {info.name}(以下「本サービス」)の
        利用条件を定めるものです。
      </p>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">第1条(適用)</h2>
        <p className="mt-2 text-sm leading-relaxed">
          本規約は、利用者と運営者との間の本サービスの利用に関わる一切の関係に適用されます。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">第2条(アカウント)</h2>
        <p className="mt-2 text-sm leading-relaxed">
          利用者はメールアドレス等により登録します。登録情報は正確なものとし、
          第三者に利用させないものとします。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">第3条(未成年者)</h2>
        <p className="mt-2 text-sm leading-relaxed">
          未成年者が本サービスを利用する場合は、あらかじめ親権者等の法定代理人の
          同意を得るものとします。とくに有料イベントへの申込は、法定代理人の同意の
          もとで行ってください。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          第4条(イベントと決済)
        </h2>
        <p className="mt-2 text-sm leading-relaxed">
          イベントの主催・運営・参加費の徴収は各グループ(主催者)が行います。
          有料イベントの取引条件・キャンセル・返金の可否は主催者が定め、
          <strong>取引は利用者と主催者の間で成立</strong>します。
          カード決済を利用する場合、<strong>参加費は主催者自身の決済アカウント
          (Stripe)で直接収受され、運営者は代金を預かりません</strong>。運営者は
          決済・イベント管理の場を提供するのみで、取引の当事者にはなりません。
          返金の実施可否・方法は主催者が判断・対応します。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">第5条(禁止事項)</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
          <li>法令または公序良俗に違反する行為</li>
          <li>他の利用者・第三者の権利を侵害する行為</li>
          <li>本サービスの運営を妨害する行為</li>
          <li>虚偽の情報の登録、なりすまし、不正アクセス</li>
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          第6条(アカウントの停止・削除)
        </h2>
        <p className="mt-2 text-sm leading-relaxed">
          利用者が本規約に違反した場合、運営者は事前の通知なく、当該利用者の
          投稿の削除・アカウントの利用停止または削除等の措置をとることができます。
          利用者はいつでも自身のアカウントを削除(退会)できます。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">第7条(免責)</h2>
        <p className="mt-2 text-sm leading-relaxed">
          運営者は、本サービスの内容や利用者間・主催者との取引について、
          法令で許容される範囲で一切の責任を負いません。本サービスは現状有姿で
          提供され、無停止・無誤りを保証するものではありません。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">第8条(規約の変更)</h2>
        <p className="mt-2 text-sm leading-relaxed">
          運営者は必要に応じて本規約を変更できます。変更後の規約は本ページに掲示した
          時点から効力を生じます。
        </p>
      </section>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          第9条(準拠法・裁判管轄)
        </h2>
        <p className="mt-2 text-sm leading-relaxed">
          本規約は日本法に準拠して解釈されます。本サービスに関して運営者と利用者との
          間で紛争が生じた場合、運営者の所在地を管轄する裁判所を第一審の専属的合意
          管轄裁判所とします。
        </p>
      </section>

      <p className="mt-8 text-sm text-neutral">
        お問い合わせ: <ContactValue contact={info.contact} contactHref={info.contactHref} />
      </p>
    </article>
  );
}

export const getConfig = async () => ({ render: 'dynamic' }) as const;
