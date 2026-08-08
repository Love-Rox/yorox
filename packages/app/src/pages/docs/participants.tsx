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
        </ul>
      </section>
    </article>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
