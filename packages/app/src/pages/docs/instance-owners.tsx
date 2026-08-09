import { Link } from 'waku';

export default async function InstanceOwnersGuidePage() {
  return (
    <article className="max-w-[70ch]">
      <title>サイトオーナー向けガイド - Yorox</title>
      <p className="text-sm">
        <Link to="/docs" className="link">
          ← 使い方
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">サイトオーナー向けガイド</h1>
      <p className="mt-3 text-neutral">
        自分の Yorox インスタンスを建てて、コミュニティのイベント基盤を運営する方向けの
        ガイドです。
      </p>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">構成</h2>
        <p className="mt-3">
          Yorox は<strong>2つの動かし方</strong>があります。手軽なのは Docker で、
          1コンテナ(SQLite にデータを保存)で完結します —{' '}
          <Link to="/docs/self-hosting" className="link">
            自分のサーバーで運営する
          </Link>
          の4ステップガイドを用意しています。もう1つは Cloudflare Workers 上での
          運用で、次のサービスを使います:
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>Workers — アプリ本体(+先着枠を直列化する Durable Objects)</li>
          <li>D1 — データベース</li>
          <li>R2 — 画像などのファイル置き場(任意)</li>
          <li>Cron Triggers — 抽選の自動実行・通知メールの配信</li>
        </ul>
        <p className="mt-3 text-sm text-neutral">
          Docker 版では D1 の代わりに SQLite、R2 の代わりにローカルファイル、Cron
          Triggers の代わりに内蔵の定期実行が使われます(設定は同じ環境変数)。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">セットアップの流れ</h2>
        <ol className="mt-3 list-inside list-decimal space-y-1">
          <li>リポジトリを取得し、依存をインストール(pnpm install)</li>
          <li>wrangler d1 create でデータベースを作成し、wrangler.jsonc に ID を設定</li>
          <li>マイグレーションを適用(pnpm db:migrate:remote)</li>
          <li>ファイルアップロードを使う場合は wrangler r2 bucket create</li>
          <li>メール送信のシークレットを設定(下記)</li>
          <li>pnpm deploy でデプロイ</li>
        </ol>
        <p className="mt-3 text-sm text-neutral">
          詳細な手順はリポジトリの README と docs/ を参照してください。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">インスタンス設定</h2>
        <p className="mt-3">主な設定(環境変数 / シークレット):</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <strong>メール</strong> — MAIL_FROM と、Resend(RESEND_API_KEY)/ SMTP
            (SMTP_HOST 等。Gmail はアプリパスワードで利用可)/ Cloudflare Email
            Service(MAIL_TRANSPORT=cloudflare)のいずれか。送信レートは
            MAIL_RATE_PER_MINUTE / PER_HOUR で制御できます
          </li>
          <li>
            <strong>ファイルアップロード</strong> — FILE_UPLOADS=1 で有効化、
            MAX_UPLOAD_MB で容量上限
          </li>
          <li>
            <strong>ソーシャルログイン(任意)</strong> — GitHub / Google / Discord の
            OAuth アプリを登録すると、ログイン画面にボタンが出ます
            (○○_CLIENT_ID / _SECRET)
          </li>
          <li>
            <strong>カード決済(任意)</strong> — Stripe(STRIPE_SECRET_KEY 等)を
            設定すると、各グループが自分の Stripe アカウントを連携してカード事前
            決済を受け付けられます
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">見た目のカスタマイズ</h2>
        <p className="mt-3">
          UI はデザイントークン(CSS カスタムプロパティ)だけで全面的に着せ替えられます。
          色・フォント・角丸などを自分のコミュニティの雰囲気に合わせてください。
          方法はリポジトリの docs/THEMING.md にまとまっています。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">運営者の責任</h2>
        <ul className="mt-3 list-inside list-disc space-y-1">
          <li>アカウント登録の窓口とユーザーサポート</li>
          <li>通報対応(イベント内の問題は主催へ、主催自体の問題は管理者へ)</li>
          <li>データのバックアップとプライバシーの管理</li>
        </ul>
        <p className="mt-3">
          分散型の世界では、インスタンスがひとつのコミュニティです。
          小さく始めて、自分たちのペースで育てていきましょう。
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
