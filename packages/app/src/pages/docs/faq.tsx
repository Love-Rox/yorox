import { Link } from 'waku';

/** よくある質問。Q&A は details/summary で折りたたみ表示 */
function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="border-b border-rule py-1">
      <summary className="min-h-11 cursor-pointer py-2 font-bold">{q}</summary>
      <div className="space-y-2 pb-4 text-[0.95rem] leading-relaxed">{children}</div>
    </details>
  );
}

export default async function FaqPage() {
  return (
    <article className="max-w-[70ch]">
      <title>よくある質問 - Yorox</title>
      <p className="text-sm">
        <Link to="/docs" className="link">
          ← 使い方
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">よくある質問</h1>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">アカウント・ログイン</h2>
        <div className="mt-2">
          <Faq q="パスワードはないのですか?">
            <p>
              ありません。ログインのたびにメールでログインリンク(マジックリンク)が届き、
              クリックするだけでログインできます。パスワードの管理や漏洩の心配が不要です。
            </p>
          </Faq>
          <Faq q="ハンドル(@名前)は後から変えられますか?">
            <p>
              変えられません。ハンドルはプロフィールやグループの URL・連合上の住所になるため
              固定です。表示名はいつでも変更できます。
            </p>
          </Faq>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">参加・キャンセル</h2>
        <div className="mt-2">
          <Faq q="先着と抽選はどう違いますか?">
            <p>
              先着は申込順に確定し、満席になると補欠として受け付けます。抽選は締切まで申込を
              集め、抽選日時に当選者が決まります(結果はお知らせが届きます)。
            </p>
          </Faq>
          <Faq q="補欠から繰り上がったらどうなりますか?">
            <p>
              空きが出ると順番に自動で繰り上がり、お知らせが届きます。イベントによっては
              繰上時に本人の承諾が必要な設定になっていて、その場合はヘッダの「要確認」から
              回答するまで確定しません。
            </p>
          </Faq>
          <Faq q="キャンセルはどこからできますか?">
            <p>
              イベントページの自分の申込状態の横にある「キャンセル」からいつでもできます。
              キャンセルすると補欠の方が自動で繰り上がります。
            </p>
          </Faq>
          <Faq q="参加者一覧に自分を表示したくないです">
            <p>
              申込後にイベントページで「一覧に表示しない」を選べます。主催者には引き続き
              見えますが、公開の参加者一覧には表示されません。
            </p>
          </Faq>
          <Faq q="有料イベントの支払いはどうなりますか?">
            <p>
              現地払い、または主催者が用意した外部決済リンクでの事前払いです。枠によっては
              「支払い確認で確定」の設定があり、その場合は支払いが確認されるまで
              席を確保した「支払い待ち」状態になります。
            </p>
          </Faq>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">当日・出欠</h2>
        <div className="mt-2">
          <Faq q="受付はどうすればいいですか?">
            <p>
              会場に QR コードが掲示されている場合は、自分のスマホで読み取るだけで
              チェックイン(出席記録)できます。ログイン済みで参加確定していることが条件です。
              QR がない場合は受付スタッフが出欠を記録します。
            </p>
          </Faq>
          <Faq q="出欠の記録は何に使われますか?">
            <p>
              あなたの参加実績(出席率)として、このインスタンスの中だけで使われます。
              抽選の重み付けや参加条件に使われることがありますが、外部には共有されません。
            </p>
          </Faq>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">Fediverse 連携</h2>
        <div className="mt-2">
          <Faq q="Misskey / Mastodon から参加できますか?">
            <p>
              できます。主催グループをフォローするとイベント告知がタイムラインに流れ、
              告知に「参加」とリプライするだけで申込できます(イベントが Fediverse 参加を
              受け付けている場合)。結果はリプライで返ってきます。キャンセルは
              「キャンセル」とリプライしてください。
            </p>
          </Faq>
          <Faq q="Fediverse アカウントと Yorox アカウントを紐付けるには?">
            <p>
              プロフィール設定の「Fediverse アカウント連携」から2つの方法があります:
              連携コードを発行してリモートアカウントからメンション投稿する方法と、
              リモートプロフィールのリンク欄に自分の Yorox プロフィール URL を載せて
              確認する方法(rel=me)です。連携すると参加履歴が統合され、
              「アカウント連携済み」限定の枠にも参加できます。
            </p>
          </Faq>
          <Faq q="Bluesky には対応していますか?">
            <p>
              Bluesky は ActivityPub ではなく AT Protocol という別の仕組みのため、
              直接の連合には対応していません。ただし Bridgy Fed などのブリッジを
              有効にしている Bluesky アカウントであれば、Fediverse アカウントとして
              フォロー・リプライ参加ができる場合があります。
            </p>
          </Faq>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">主催者向け</h2>
        <div className="mt-2">
          <Faq q="参加枠の「5つの要素」とは何ですか?">
            <p>
              方式(先着/抽選)・補欠モデル・繰上ポリシー・抽選ロジック・参加条件の
              5要素を枠ごとに組み合わせられます。各項目の「?」アイコンに説明があります。
              詳しくは
              <Link to="/docs/organizers" className="link">
                主催者向けガイド
              </Link>
              をご覧ください。
            </p>
          </Faq>
          <Faq q="参加者名簿を持ち出せますか?">
            <p>
              管理コンソールの「参加者のエクスポート」から、印刷用の受付名簿と
              CSV(絵文字コードあり/なしの2種類)をダウンロードできます。
            </p>
          </Faq>
          <Faq q="イベントを編集したら告知はどうなりますか?">
            <p>
              公開済みイベントを編集すると、フォロワーのタイムラインに流れた告知も
              自動で更新されます(同じ投稿が新しい内容に置き換わります)。
            </p>
          </Faq>
        </div>
      </section>
    </article>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
