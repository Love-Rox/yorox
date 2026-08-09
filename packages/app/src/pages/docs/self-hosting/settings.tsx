import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import {
  Cmd,
  GuideNav,
  NextStep,
  isGuideEnabled,
} from '../../../components/selfhost-guide';

/** セルフホストガイド STEP 3: 設定する */
export default async function SelfHostingSettingsPage() {
  if (!(await isGuideEnabled())) return notFound();

  return (
    <article className="max-w-[70ch]">
      <title>STEP 3: 設定する - Yorox</title>
      <p className="text-sm">
        <Link to="/docs/self-hosting" className="link">
          ← 自分のサーバーで運営する
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">STEP 3: 設定する</h1>
      <GuideNav current="settings" />

      <p className="mt-6">
        設定はすべて <span className="meta-mono">compose.yaml</span> の
        <span className="meta-mono"> environment</span> で行います。変更したら
        <span className="meta-mono"> docker compose up -d </span>
        で反映されます。
      </p>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          メール送信(SMTP)— 推奨
        </h2>
        <p className="mt-3">
          設定するとログインリンクや参加通知がメールで届くようになります
          (未設定の間はコンテナログに出続けます):
        </p>
        <Cmd>{`environment:
  MAIL_TRANSPORT: smtp
  MAIL_FROM: 'Yorox <noreply@example.com>'
  SMTP_HOST: smtp.gmail.com
  SMTP_PORT: '587'
  SMTP_USERNAME: you@gmail.com
  SMTP_PASSWORD: xxxx xxxx xxxx xxxx   # Gmail はアプリパスワード`}</Cmd>
        <p className="mt-2 text-sm text-neutral">
          Gmail の場合: Google アカウント → セキュリティ → 2段階認証 →
          アプリパスワード で発行します。送信数はレート制御されます
          (既定 10通/分・100通/時、MAIL_RATE_* で変更可)。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">画像アップロード</h2>
        <Cmd>{`environment:
  FILE_UPLOADS: '1'     # アバター・サムネイルのアップロードを有効化
  MAX_UPLOAD_MB: '5'    # 1ファイルの上限(MB)`}</Cmd>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          OAuth ログイン(任意)
        </h2>
        <p className="mt-3">
          GitHub / Google の OAuth アプリを作成して設定すると、ログイン画面に
          ボタンが現れます。コールバック URL は
          <span className="meta-mono">
            {' '}
            https://あなたのドメイン/auth/oauth/github/callback{' '}
          </span>
          (google も同様)です:
        </p>
        <Cmd>{`environment:
  GITHUB_CLIENT_ID: ...
  GITHUB_CLIENT_SECRET: ...
  GOOGLE_CLIENT_ID: ...
  GOOGLE_CLIENT_SECRET: ...`}</Cmd>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">設定一覧</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-left">
                <th className="py-1.5 pr-3">変数</th>
                <th className="py-1.5">説明</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['MAIL_TRANSPORT', 'smtp を指定(未設定はログ出力のみ)'],
                ['MAIL_FROM', '送信元(例: Yorox <noreply@example.com>)'],
                ['SMTP_HOST / PORT / USERNAME / PASSWORD', 'SMTP サーバー情報'],
                ['MAIL_RATE_PER_MINUTE / PER_HOUR', '送信レート上限(既定 10 / 100)'],
                ['FILE_UPLOADS', "'1' でアップロード有効"],
                ['MAX_UPLOAD_MB', 'アップロード上限 MB(既定 5)'],
                ['GITHUB_CLIENT_ID / SECRET', 'GitHub ログイン'],
                ['GOOGLE_CLIENT_ID / SECRET', 'Google ログイン'],
                ['PUBLIC_ORIGIN', '公開 URL(リバースプロキシ背後では必須)'],
                ['DATA_DIR', 'データ保存先(既定 /data)'],
                ['PORT', '待受ポート(既定 8080)'],
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-rule">
                  <td className="meta-mono py-1.5 pr-3">{k}</td>
                  <td className="py-1.5">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <NextStep slug="operations" />
    </article>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
