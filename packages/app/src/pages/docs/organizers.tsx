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
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          当日の受付(QR チェックイン)
        </h2>
        <p className="mt-3">
          受付は <strong>QR セルフチェックイン</strong>が基本です。参加者が自分の
          スマホで QR を読むだけで出席が記録されるので、受付の行列と名簿の
          突き合わせがほぼなくなります。
        </p>

        <h3 className="mt-5 font-bold">事前準備(前日まで)</h3>
        <ol className="mt-2 list-inside list-decimal space-y-1">
          <li>イベントの「管理コンソール」→「QR チェックイン」で QR を発行する</li>
          <li>
            「掲示用ポスターを印刷 / PDF」から A4 ポスターを印刷しておく
            (イベント名・手順・「アカウントをお持ちでない方は個別受付します」の
            案内が入っています)
          </li>
        </ol>

        <h3 className="mt-5 font-bold">当日の流れ</h3>
        <ol className="mt-2 list-inside list-decimal space-y-1">
          <li>受付にポスターを掲示する(複数箇所に貼っても OK)</li>
          <li>
            参加者がスマホで QR を読む → ログイン済みで参加確定の本人なら
            その場で「チェックイン完了」と表示され、出席が記録される
          </li>
          <li>
            管理コンソールの参加者一覧に [出席] が付いていく。
            <strong>検索ボックス</strong>で名前・ハンドルを打てばリアルタイムに
            絞り込めます
          </li>
        </ol>

        <h3 className="mt-5 font-bold">QR が使えない参加者(個別受付)</h3>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <strong>Misskey / Mastodon から申し込んだ人(未連携)</strong> —
            Yorox にログインできないため QR は使えません。名前を聞いて管理
            コンソールで検索し、「出席」ボタンで記録してください。本人がその場で
            アカウント連携すれば以後 QR が使えます
          </li>
          <li>
            <strong>スマホがない・ログインできない人</strong> — 同じく検索 →
            「出席」で手動記録
          </li>
          <li>
            紙で運用したい場合は「参加者のエクスポート」から
            <strong>印刷用の受付名簿</strong>(チェック欄付き)も使えます
          </li>
        </ul>

        <h3 className="mt-5 font-bold">知っておくと安心</h3>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            チェックインは<strong>本人の出席だけ</strong>を記録します(他人の分は
            記録できません)。二度読みしても重複しません
          </li>
          <li>
            QR の URL が外部に漏れた場合は「QR を再発行」してください。
            古い QR は即座に無効になります
          </li>
          <li>
            補欠・抽選待ちの人が読むと「参加確定ではありません」と表示されます
            (勝手に確定にはなりません)
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">運営あれこれ</h2>
        <p className="mt-3">
          管理コンソールでは他に、抽選の実行(締切前でも手動実行可)・手動選定・
          無断欠席の記録・支払いの確認・参加者への一斉/個別メッセージ送信が
          できます。出欠記録は次回以降の抽選(出欠率重み付け)の材料になります。
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
