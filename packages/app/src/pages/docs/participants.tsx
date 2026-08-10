import { Link } from 'waku';

export default async function ParticipantsGuidePage() {
  return (
    <article className="max-w-[70ch]">
      <title>参加者向けガイド - Yorox</title>
      <p className="text-sm">
        <Link to="/docs" className="link">
          ← 使い方
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">参加者向けガイド</h1>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">アカウント作成</h2>
        <p className="mt-3">
          メールアドレスだけで登録できます。「ログイン」からメールアドレスを入力すると
          ログインリンクが届きます(パスワードは不要です)。初回はハンドルと表示名を
          決めるだけで完了。同じハンドルであなたの個人グループも作成されます。
        </p>
        <p className="mt-3">
          2回目以降は、メールのログインリンクのほか、<strong>パスキー</strong>(指紋・顔・
          端末のロック)や、連携した <strong>GitHub / Google / Discord</strong> のボタンで
          すぐログインできます(設定は任意)。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">イベントに申し込む</h2>
        <p className="mt-3">
          イベントページの「参加枠」から申し込みます。枠には2つの方式があります:
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <strong>先着</strong> — 定員内なら即確定。満席のときは補欠として受け付けます
          </li>
          <li>
            <strong>抽選</strong> — 締切まで受け付け、抽選で当選者が決まります。
            結果はメールとイベントページで確認できます
          </li>
        </ul>
        <p className="mt-3">
          抽選枠に申し込むとき、他に枠があれば<strong>第2希望</strong>を選べます。
          選んでおくと、落選したとき補欠には残らず、第2希望の枠へ自動で申し込みます
          (先着枠なら空きがあれば即確定)。
        </p>
        <p className="mt-3">
          補欠のときは、空きが出ると順番に繰り上がります。イベントによっては繰上時に
          本人の承諾が必要な場合があり、その際はヘッダの「要確認」からご回答ください。
        </p>
        <p className="mt-3">
          枠に<strong>参加条件</strong>が設定されていることがあります(アカウント作成からの
          日数、参加実績の回数、指定の Discord サーバーへの所属など)。条件は枠の欄に
          表示されるので、申し込む前にご確認ください。
        </p>
        <p className="mt-3">
          「指定の Discord サーバーの参加者のみ」の枠に申し込むには、
          設定 &gt; 連携済みアカウント で <strong>Discord を連携</strong>したうえで、
          主催者が指定するサーバーに参加している必要があります。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">フォローとタイムライン</h2>
        <p className="mt-3">
          ユーザーやグループのページにある「フォロー」ボタンを押すと、ヘッダの
          メニューにある<strong>タイムライン</strong>に、その相手の公開活動
          (新しいイベントの公開・グループのお知らせ・公開の参加予定)が新しい順に
          並びます。フォローされた人には通知が届き、フォロー中のグループが
          イベントを公開したときにもお知らせが届きます。
        </p>
        <p className="mt-3 text-sm text-neutral">
          タイムラインに流れるのは公開情報だけです。参加者一覧を非公開にした
          イベントへの参加や、あなたが一覧から自分を隠した参加は表示されません。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">参加費のあるイベント</h2>
        <p className="mt-3">
          有料イベントでは枠に金額と支払方法(現地払い / 事前決済)が表示されます。
          「支払い確認で確定」の枠では、支払いが確認されるまで「支払い待ち」と表示されます
          (席は確保されています)。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">キャンセルと公開設定</h2>
        <ul className="mt-3 list-inside list-disc space-y-1">
          <li>キャンセルはイベントページの参加状態の横からいつでもできます</li>
          <li>
            参加者一覧に自分を表示したくない場合は「一覧に表示しない」を選べます
          </li>
          <li>
            参加が確定すると「参加者への案内」(会場の入り方や配信 URL など)が
            イベントページに表示されます
          </li>
          <li>
            開催24時間前に、参加確定者へリマインダーのお知らせが届きます
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          カレンダー連携
        </h2>
        <p className="mt-3">
          各イベントページから「カレンダーに追加」(.ics / Google カレンダー)ができます。
          さらにプロフィール設定の「参加予定カレンダー」で購読 URL を発行すると、
          参加確定したイベントが自動で入るカレンダーを Google / Apple カレンダーなどで
          購読でき、以後の参加・キャンセルも自動で反映されます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          データと退会
        </h2>
        <p className="mt-3">
          プロフィール設定の「データと退会」から、自分のプロフィール・参加履歴・
          出欠・支払いなどを <strong>JSON でエクスポート</strong>できます。
          <strong>退会</strong>すると、メールアドレスやログイン情報は削除され、
          進行中の申込はキャンセルされます(主催者側の集計のため、過去の記録は
          匿名化された形で残ることがあります)。
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
