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
          補欠のときは、空きが出ると順番に繰り上がります。イベントによっては繰上時に
          本人の承諾が必要な場合があり、その際はヘッダの「要確認」からご回答ください。
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
