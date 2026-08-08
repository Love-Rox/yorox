import { Link } from 'waku';

export default async function OrganizersGuidePage() {
  return (
    <article className="max-w-[70ch]">
      <title>主催者向けガイド - Yorox</title>
      <p className="text-sm">
        <Link to="/docs" className="link">
          ← 使い方
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">主催者向けガイド</h1>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">グループを作る</h2>
        <p className="mt-3">
          イベントは必ずグループから開催します(個人開催の場合は登録時に作られる
          個人グループが使えます)。トップページの「グループを作る」から新しい
          グループを作成でき、作成者はオーナーになります。
        </p>
        <p className="mt-3">
          グループの「設定」からメンバーの追加(ハンドル指定)、ロールの変更ができます。
          ロールはプリセット(オーナー / 共同主催 / メンバー)のほか、権限フラグを
          組み合わせた<strong>カスタムロール</strong>(例: 出欠管理だけできる受付スタッフ)を
          定義できます。全権限を持つメンバーが最低1人残るよう保護されています。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">イベントを作る</h2>
        <p className="mt-3">
          グループページの「イベント作成」から下書きを作り、参加枠を設定してから
          公開します。本文は Markdown で書け、サムネイル画像・会場(住所から地図を
          自動表示)・配信 URL・タイムテーブル・資料リンクを設定できます。
          「参加者への案内」は参加確定者だけに表示される欄です。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">参加枠のポリシー</h2>
        <p className="mt-3">枠ごとに次の5つを選べます:</p>
        <ol className="mt-2 list-inside list-decimal space-y-1">
          <li>
            <strong>方式</strong> — 先着 / 抽選
          </li>
          <li>
            <strong>補欠モデル</strong> — 落選・溢れは補欠(Connpass 流)/ 補欠数を指定
          </li>
          <li>
            <strong>繰上ポリシー</strong> — 即時自動 / 締切付き自動(開催X時間前で停止)/
            本人承諾型
          </li>
          <li>
            <strong>抽選ロジック</strong> — 完全ランダム / 主催の手動選定 /
            出欠率による重み付け
          </li>
          <li>
            <strong>参加条件</strong> — アカウント年齢や参加実績などの組み合わせ
          </li>
        </ol>
        <p className="mt-3">
          参加費を設定すると有料枠になります。支払方法は現地払いか外部決済リンク
          (Stripe Payment Links など)で、「支払い確認で確定」を選ぶと支払いが
          確認されるまで席を保持したまま確定を保留できます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">当日と運営</h2>
        <p className="mt-3">
          イベントページの「管理コンソール」で申込者の一覧・抽選の実行(自動抽選の
          締切前でも手動実行可)・手動選定・出欠記録(出席 / 無断欠席)・支払いの
          確認ができます。出欠記録は次回以降の抽選(出欠率重み付け)の材料になります。
        </p>
        <p className="mt-3">
          終了後は資料リンクを追加して、参加できなかった人にも成果を届けましょう。
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
