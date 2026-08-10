import { Link } from 'waku';
import { ActorKindMark } from '../components/actor-kind';
import { getDb, listUpcomingEvents } from '../server/data';

const DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Tokyo',
});
const TIME_FMT = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tokyo',
});
const WEEKDAY_FMT = new Intl.DateTimeFormat('ja-JP', {
  weekday: 'short',
  timeZone: 'Asia/Tokyo',
});

/** トップに載せる直近イベントの上限 */
const TOP_EVENT_LIMIT = 12;

export default async function HomePage() {
  const db = await getDb();
  const upcoming = await listUpcomingEvents(db, TOP_EVENT_LIMIT);

  return (
    <div>
      <title>Yorox — 分散型イベント管理プラットフォーム</title>
      <meta
        name="description"
        content="Yorox は、コミュニティが自分たちで運営できる分散型のイベント管理プラットフォームです。告知・申込・抽選・決済・当日の QR チェックインまで一つで。ActivityPub 連合対応。"
      />
      <meta property="og:site_name" content="Yorox" />
      <meta property="og:title" content="Yorox" />
      <meta
        property="og:description"
        content="コミュニティが自分たちで運営できる、分散型のイベント管理プラットフォーム。"
      />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="https://yorox.love-rox.cc/" />
      <meta property="og:image" content="https://yorox.love-rox.cc/images/og-default.png" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta name="twitter:card" content="summary_large_image" />
      {/*
        構造化データ。アプリ名と目的を機械可読で示す。
        Google OAuth のブランディング審査は「同意画面のアプリ名がホームページに
        掲載されているか」を見るため、見出し・title に加えてここでも名乗る。
      */}
      {/* 値はすべてこのファイル内の定数。念のため < をエスケープして </script> 混入を防ぐ */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: 'Yorox',
            alternateName: 'Yorox — 分散型イベント管理プラットフォーム',
            url: 'https://yorox.love-rox.cc/',
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Web',
            inLanguage: 'ja',
            description:
              'Yorox は、コミュニティが中央のサービスに頼らず自分たちで運営できる分散型のイベント管理プラットフォームです。イベントの告知・参加申込(先着 / 抽選 / 補欠の繰上)・有料イベントの決済・当日の QR チェックインまでを一つで行えます。',
            publisher: { '@type': 'Organization', name: 'Rox Developer' },
            privacyPolicy: 'https://yorox.love-rox.cc/legal/privacy',
            termsOfService: 'https://yorox.love-rox.cc/legal/terms',
          }).replaceAll('<', '\\u003c'),
        }}
      />

      {/* サービスの名称と目的(トップに明示) */}
      <section className="mb-10">
        <h1 className="display t-xl">Yorox</h1>
        <p className="mt-3 leading-relaxed text-neutral">
          <strong className="text-ink">Yorox</strong>{' '}
          は、コミュニティが中央のサービスに頼らず自分たちで運営できる、
          分散型のイベント管理プラットフォームです。メールアドレスだけで登録でき
          (Google・GitHub・Discord のアカウントでもログインできます)、
          イベントの告知・参加申込(先着 / 抽選 / 補欠の繰上)・有料イベントの決済・
          当日の QR チェックインまでを一つで行えます。
        </p>
        <p className="mt-3 leading-relaxed text-neutral">
          主催はグループ単位で権限を分けて共同運営でき、参加者にはメールや Discord で
          リマインダーが届き、カレンダー(ics)にも取り込めます。
          ActivityPub による連合に対応しているので、Fediverse の他サーバーからも参加できます。
          使い方は{' '}
          <Link to="/docs" className="link">
            ガイド
          </Link>
          をご覧ください。
        </p>
      </section>

      {/* Index-First: 導入は一行、以降はリストが主役 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="meta-mono text-sm text-neutral">
          今後のイベント(直近{TOP_EVENT_LIMIT}件)
        </p>
        <span className="flex gap-4 text-sm">
          <Link to="/docs" className="link">
            使い方
          </Link>
        </span>
      </div>

      {upcoming.length === 0 ? (
        <p className="mt-6 text-neutral">
          公開中のイベントはまだありません。グループを作って最初のイベントを立てましょう。
        </p>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((event) => (
            <li key={event.id} className="min-w-0">
              <Link
                to={`/g/${event.groupHandle}/events/${event.id}`}
                className="group block h-full border-2 border-ink bg-paper transition-shadow hover:shadow-[4px_4px_0_var(--yorox-accent)]"
              >
                {event.thumbnailUrl ? (
                  <img
                    referrerPolicy="no-referrer"
                    src={event.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="h-28 w-full border-b border-rule object-cover"
                  />
                ) : (
                  <div className="flex h-12 items-center border-b border-rule bg-paper-2 px-3">
                    <span className="display t-md leading-none text-neutral">
                      {DATE_FMT.format(event.startsAt)}
                    </span>
                  </div>
                )}
                <div className="p-3">
                  <div className="meta-mono text-sm text-neutral">
                    {DATE_FMT.format(event.startsAt)} ({WEEKDAY_FMT.format(event.startsAt)}){' '}
                    {TIME_FMT.format(event.startsAt)}
                  </div>
                  <div className="mt-1 line-clamp-2 font-bold group-hover:underline">
                    {event.title}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-sm text-neutral">
                    <ActorKindMark
                      kind="group"
                      isPersonal={event.groupIsPersonal}
                      size={13}
                      className="shrink-0"
                    />
                    <span className="truncate">
                      {event.groupName}
                      {event.venueName
                        ? ` · ${event.venueName}`
                        : event.onlineUrl
                          ? ' · オンライン'
                          : ''}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* ---- Yorox の使い方 ---- */}
      <section className="mt-14">
        <h2 className="display border-b-2 border-ink pb-2 t-md">Yorox の使い方</h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          <li className="border border-rule p-4">
            <p className="meta-mono text-sm text-neutral">STEP 1</p>
            <p className="mt-1 font-bold">メールだけで登録</p>
            <p className="mt-1 text-sm leading-relaxed">
              パスワード不要。メールに届くリンクをクリックし、ハンドル(@名前)を
              決めれば完了です。
            </p>
          </li>
          <li className="border border-rule p-4">
            <p className="meta-mono text-sm text-neutral">STEP 2</p>
            <p className="mt-1 font-bold">イベントを見つけて申し込む</p>
            <p className="mt-1 text-sm leading-relaxed">
              参加枠から申し込むだけ。先着・抽選・補欠繰上の結果はメールで
              お知らせします。キャンセルもワンクリックです。
            </p>
          </li>
          <li className="border border-rule p-4">
            <p className="meta-mono text-sm text-neutral">STEP 3</p>
            <p className="mt-1 font-bold">当日は QR でチェックイン</p>
            <p className="mt-1 text-sm leading-relaxed">
              会場の QR をスマホで読み取るだけで受付完了。参加実績として
              記録されます。
            </p>
          </li>
        </ol>

        <div className="mt-6 border-2 border-ink bg-paper-2 p-4">
          <h3 className="font-bold">アカウントとグループの違い</h3>
          <p className="mt-2 text-sm leading-relaxed">
            <strong>アカウント</strong>はあなた個人のものです(イベントへの参加・
            プロフィールに使います)。登録すると同じハンドルの
            <strong>個人グループ</strong>も自動で作られ、イベントの主催は
            必ずグループ名義で行います。ひとりで主催するなら個人グループを
            そのまま、仲間と運営するなら共用のグループを新しく作って
            メンバーと役割を分担できます。
          </p>
        </div>

        <p className="mt-4 text-sm">
          Misskey / Mastodon などの Fediverse からは、グループをフォローすると
          告知がタイムラインに届き、リプライだけで参加申込もできます。詳しくは
          <Link to="/docs" className="link">
            使い方ガイド
          </Link>
          と
          <Link to="/docs/faq" className="link">
            FAQ
          </Link>
          へ。
        </p>
      </section>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
