import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import {
  GUIDE_STEPS,
  GuideNav,
  isGuideEnabled,
} from '../../../components/selfhost-guide';

/** セルフホストガイド: 概要(SELF_HOSTING_GUIDE=1 のインスタンスのみ表示) */
export default async function SelfHostingIndexPage() {
  if (!(await isGuideEnabled())) return notFound();

  return (
    <article className="max-w-[70ch]">
      <title>自分のサーバーで運営する - Yorox</title>
      <p className="text-sm">
        <Link to="/docs" className="link">
          ← 使い方
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">自分のサーバーで運営する</h1>
      <GuideNav current="" />

      <p className="mt-6">
        Yorox はオープンソースの分散型プラットフォームです。このサーバーを
        使い続けてもよいですし、<strong>自分のドメインで自分のインスタンス</strong>
        を立てることもできます。インスタンス同士は ActivityPub で繋がるため、
        どこで立ててもフォローや参加は相互に届きます。
      </p>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">必要なもの</h2>
        <ul className="mt-3 list-inside list-disc space-y-1">
          <li>
            <strong>Docker が動くサーバー</strong> — VPS(月数百円のもので十分)や
            自宅サーバー。メモリ 512MB〜で動きます
          </li>
          <li>
            <strong>ドメイン</strong> — あなたのインスタンスの住所になります
            (例: events.example.com)。<strong>後から変更できない</strong>ので
            最初に決めてください
          </li>
          <li>
            <strong>メール送信手段(推奨)</strong> — ログインリンクの送信用。
            Gmail のアプリパスワードでも OK。なくても試せます
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">全体の流れ</h2>
        <ol className="mt-3 space-y-3">
          {GUIDE_STEPS.filter((s) => s.slug).map((s) => (
            <li key={s.slug} className="border border-rule p-3">
              <Link to={`/docs/self-hosting/${s.slug}`} className="link font-bold">
                {s.title}
              </Link>
              <p className="mt-1 text-sm text-neutral">{s.short}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-neutral">
          お試しなら STEP 1 だけで手元で動きます。他の人と使う・Fediverse と
          繋ぐなら STEP 2 まで進めてください。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">ソースコード</h2>
        <p className="mt-3">
          <a
            href="https://github.com/Love-Rox/yorox"
            className="link meta-mono"
            rel="noreferrer"
            target="_blank"
          >
            github.com/Love-Rox/yorox
          </a>
          — 不具合報告や改善提案も歓迎です。
        </p>
      </section>
    </article>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
