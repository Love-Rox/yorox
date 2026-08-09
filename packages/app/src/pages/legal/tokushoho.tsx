import type { ReactNode } from 'react';
import {
  ContactValue,
  instanceInfo,
  LegalNav,
  OperatorNotice,
} from '../../components/legal';

/**
 * 特定商取引法に基づく表記(テンプレート)。
 * 有料イベントの販売者は各主催者(グループ)であり、原則として主催者が
 * 自らの表記を行う責任を負う。本ページはプラットフォーム運営者の表記。
 */
export default async function TokushohoPage() {
  const info = await instanceInfo();
  const rows: [string, ReactNode][] = [
    ['サービス名', info.name],
    ['運営者', info.operator],
    ['所在地・電話番号', '請求があった場合には遅滞なく開示します(連絡先までご請求ください)'],
    ['連絡先', <ContactValue contact={info.contact} contactHref={info.contactHref} />],
    ['販売価格', '各イベントページに表示(有料イベントの場合)'],
    ['代金の支払時期・方法', '各イベントの定めによる(現地払い / 外部決済 / カード決済)'],
    [
      '商品の引渡時期',
      'イベント開催日時(各イベントページに表示)',
    ],
    [
      'キャンセル・返金',
      '主催者が定める条件によります。返金の可否・方法は主催者にお問い合わせください。',
    ],
  ];
  return (
    <article className="max-w-[70ch]">
      <title>特定商取引法に基づく表記 - Yorox</title>
      <h1 className="display t-xl">特定商取引法に基づく表記</h1>
      <LegalNav />
      <OperatorNotice configured={info.configured} />

      <p className="mt-6 text-sm text-neutral">
        有料イベントの販売者は各主催者(グループ)です。個々の取引条件は
        イベントページおよび主催者の定めによります。カード決済の代金は
        主催者自身の決済アカウントで直接収受され、運営者は代金を預かりません。
        したがって特定商取引法に基づく表記は、本来は各主催者が自ら行うものです。
        本表記はプラットフォーム運営者に関するものです。
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b border-rule align-top">
                <th className="w-40 py-2 pr-3 text-left font-bold">{k}</th>
                <td className="py-2">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export const getConfig = async () => ({ render: 'dynamic' }) as const;
