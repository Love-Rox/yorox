import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import {
  Cmd,
  NextStep,
  isGuideEnabled,
} from '../../../components/selfhost-guide';

/** セルフホストガイド STEP 2: 公開する */
export default async function SelfHostingDomainPage() {
  if (!(await isGuideEnabled())) return notFound();

  return (
    <article className="max-w-[70ch]">
      <title>STEP 2: 公開する - Yorox</title>
      <p className="text-sm">
        <Link to="/docs/self-hosting" className="link">
          ← 自分のサーバーで運営する
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">STEP 2: 公開する(ドメインと HTTPS)</h1>

      <div className="mt-6 border-2 border-accent p-4">
        <p className="font-bold text-accent">最重要: ドメインは一度決めたら変えられません</p>
        <p className="mt-1 text-sm">
          ドメインはアカウントやイベントの Fediverse 上の住所(URI)に焼き込まれます。
          運用開始後に変えると、フォロワーや連合先との関係がすべて壊れます。
        </p>
      </div>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">なぜ HTTPS が必要か</h2>
        <ul className="mt-3 list-inside list-disc space-y-1">
          <li>Fediverse 連合(フォロー・リプライ参加)は HTTPS が前提です</li>
          <li>パスキーは HTTPS(または localhost)でしか動きません</li>
        </ul>
        <p className="mt-2">
          DNS でドメインをサーバーに向けたうえで、以下のいずれかで HTTPS を
          終端し、コンテナの 8080 番へ転送します。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          方法A: Caddy(いちばん簡単)
        </h2>
        <p className="mt-3">証明書の取得・更新まで全自動です。Caddyfile はこれだけ:</p>
        <Cmd>{`events.example.com {
    reverse_proxy localhost:8080
}`}</Cmd>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">方法B: nginx + certbot</h2>
        <Cmd>{`server {
    server_name events.example.com;
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
# certbot --nginx -d events.example.com で HTTPS 化`}</Cmd>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          方法C: Cloudflare Tunnel(ポート開放なし)
        </h2>
        <p className="mt-3">
          自宅サーバーなどでポートを開けたくない場合は Cloudflare Tunnel が便利です:
        </p>
        <Cmd>{`cloudflared tunnel create yorox
cloudflared tunnel route dns yorox events.example.com
cloudflared tunnel run --url http://localhost:8080 yorox`}</Cmd>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">動作確認</h2>
        <ul className="mt-3 list-inside list-disc space-y-1">
          <li>
            <span className="meta-mono">https://あなたのドメイン</span> で Yorox が開く
          </li>
          <li>
            Misskey / Mastodon の検索で
            <span className="meta-mono"> @あなたのハンドル@あなたのドメイン </span>
            が見つかり、フォローできる(連合の確認)
          </li>
        </ul>
      </section>

      <NextStep slug="settings" />
    </article>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
