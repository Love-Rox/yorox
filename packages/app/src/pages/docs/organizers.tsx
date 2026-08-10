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
          イベントは必ずグループから開催します。ひとりで主催するなら、登録時に自動で
          作られる<strong>個人グループ</strong>(あなたと同じハンドル)がそのまま使えます。
          仲間と共同運営するなら<strong>共用グループ</strong>を新しく作成します — 自分の
          プロフィールの「グループ」欄にある「共用グループを作成」から作れ、作成者は
          オーナーになります。
        </p>
        <p className="mt-3">
          共用グループの「設定」からメンバーの追加(ハンドル指定)、ロールの変更が
          できます。ロールはプリセット(オーナー / 共同主催 / メンバー)のほか、権限
          フラグを組み合わせた<strong>カスタムロール</strong>(例: 出欠管理だけできる
          受付スタッフ)を定義できます。全権限を持つメンバーが最低1人残るよう保護
          されています。なお<strong>個人グループには他のメンバーを追加できません</strong>
          (あなた1人のためのグループです)。共同運営が必要になったら共用グループを
          作成してください。
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
            <strong>参加条件</strong> — アカウント年齢・参加実績・アカウント連携済み・
            指定の Discord サーバーへの所属(AND で評価)
          </li>
        </ol>

        <h3 className="display mt-6 t-sm">参加者一覧の公開範囲</h3>
        <p className="mt-2">
          イベントの編集画面で、参加者一覧をどこまで見せるかを選べます。
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <strong>参加が確定した人の一覧を公開する</strong> — 既定でオン。
            オフにすると一覧そのものを非公開にします
          </li>
          <li>
            <strong>抽選待ち・補欠の申込者も一覧に載せる</strong> — 既定でオフ。
            オンにすると、まだ結果の出ていない申込者も「抽選待ち」「補欠」の
            表示付きで一覧に並びます
          </li>
        </ul>
        <p className="mt-2">
          抽選待ちを公開すると、誰が申し込んだかが抽選前に分かります。
          あとで落選した人がいることも第三者に伝わるため、
          そうなってよいイベントかどうかをご検討ください。
          なお参加者は自分の判断で一覧から自分を隠せます。その設定は公開範囲より優先されます。
        </p>

        <h3 className="display mt-6 t-sm">枠をあとから編集する</h3>
        <p className="mt-2">
          イベントページの各枠にある「この枠を編集」から、枠名・定員・参加条件などを
          変更できます。申込がまだ無い枠は削除もできます。
        </p>
        <p className="mt-2">
          ただし、<strong>申込が入っている枠</strong>では、既存の参加者の扱いが壊れる
          次の項目を変更できません:
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>方式(先着 ↔ 抽選) — 状態の持ち方が違うため</li>
          <li>補欠モデル — 繰上の順序と母数の意味が変わるため</li>
          <li>参加費・支払方法 — 支払済みの人と条件が食い違うため</li>
        </ul>
        <p className="mt-2">
          これらを変えたいときは、新しい枠を作ってください。
          定員は申込後でも変更できます(減らしても確定済みの参加者は取り消されません。
          「これ以上受け付けない」という意味になります)。
          抽選が終わった枠では、抽選日時を動かせません。
        </p>

        <h3 className="display mt-6 t-sm">Discord サーバーの参加者だけに限定する</h3>
        <p className="mt-2">
          「指定の Discord サーバーの参加者のみ」を有効にすると、申込時に対象サーバーへの
          所属を確認します。使うには次の準備が必要です。
        </p>
        <ol className="mt-2 list-inside list-decimal space-y-1">
          <li>Yorox の Bot を対象の Discord サーバーに招待する</li>
          <li>
            グループ設定に対象サーバーの ID を登録する(枠ごとに別のサーバーを指定することもできます)
          </li>
          <li>参加者側も、設定から Discord アカウントを連携しておく</li>
        </ol>
        <p className="mt-2">
          サーバー ID は Discord で開発者モードを有効にし、サーバー名を右クリック →
          「サーバー ID をコピー」で取得できます。
          Bot が対象サーバーに居ない・Discord 側の障害などで所属を確認できなかったときは、
          条件が骨抜きにならないよう<strong>申込を断ります</strong>。
          グループ設定の保存時に Bot がサーバーに居るかを確認するので、
          先に招待を済ませてください。
        </p>
        <p className="mt-2">
          参加者が Discord を連携していれば、参加者 CSV に Discord のユーザー名と
          ユーザー ID の列が出力されます(主催者のみ)。ロール付与などにお使いください。
        </p>
        <p className="mt-3">
          参加費を設定すると有料枠になります。支払方法は3種類:
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <strong>現地払い</strong> — 当日会場で受け取る
          </li>
          <li>
            <strong>外部決済リンク</strong> — Stripe Payment Links など任意の URL を貼る
          </li>
          <li>
            <strong>Stripe(カード事前決済)</strong> — グループの設定で Stripe
            アカウントを連携すると、申込時にカード決済できます。売上はグループの
            Stripe アカウントに直接入り、キャンセル時は管理コンソールから返金
            (する/しない)を選べます
          </li>
        </ul>
        <p className="mt-3">
          「支払い確認で確定」を選ぶと、支払いが確認されるまで席を保持したまま確定を
          保留できます。
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
          無断欠席の記録・支払いの確認/返金・参加者への一斉/個別メッセージ送信が
          できます。出欠記録は次回以降の抽選(出欠率重み付け)の材料になります。
          申込者ごとの過去の参加率も一覧で確認できます。
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <strong>イベントの複製</strong> — 定例イベントは「複製して新規作成」で
            枠やセッションごと下書きにコピーできます
          </li>
          <li>
            <strong>開催前リマインダー</strong> — 開催24時間前に、参加確定者へ自動で
            お知らせが届きます
          </li>
          <li>
            <strong>参加者ブロック</strong> — 迷惑な相手はグループ設定または管理
            コンソールからブロックでき、以後そのグループのイベントに申し込めなく
            なります
          </li>
          <li>
            <strong>イベント単位の管理者</strong> — グループ全体ではなく、特定
            イベントだけの共同管理者を追加できます
          </li>
        </ul>
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
