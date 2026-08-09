import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import {
  Cmd,
  NextStep,
  isGuideEnabled,
} from '../../../components/selfhost-guide';

/** セルフホストガイド STEP 1: 起動する */
export default async function SelfHostingSetupPage() {
  if (!(await isGuideEnabled())) return notFound();

  return (
    <article className="max-w-[70ch]">
      <title>STEP 1: 起動する - Yorox</title>
      <p className="text-sm">
        <Link to="/docs/self-hosting" className="link">
          ← 自分のサーバーで運営する
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">STEP 1: 起動する</h1>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">1. 取得して起動</h2>
        <Cmd>{`git clone https://github.com/Love-Rox/yorox.git
cd yorox
docker compose up -d`}</Cmd>
        <p className="mt-3">
          初回はイメージのビルドに数分かかります。起動すると
          <span className="meta-mono"> http://localhost:8080 </span>
          で Yorox が開きます。データベースの初期化(マイグレーション)は
          起動時に自動で行われます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          2. 最初のアカウントを作る
        </h2>
        <p className="mt-3">
          「ログイン」からメールアドレスを入力します。メール(SMTP)を
          まだ設定していないので、ログインリンクは<strong>コンテナのログ</strong>に
          出力されます:
        </p>
        <Cmd>{`docker compose logs -f yorox
# → [mail] のあとに http://localhost:8080/auth/... のリンクが出る`}</Cmd>
        <p className="mt-3">
          そのリンクをブラウザで開き、ハンドル(@名前)と表示名を決めれば
          アカウント完成です。同じハンドルの個人グループも自動で作られ、
          すぐイベントを立てられます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">3. データの場所</h2>
        <p className="mt-3">
          すべてのデータは Docker ボリューム
          <span className="meta-mono"> yorox-data</span>(コンテナ内
          <span className="meta-mono"> /data</span>)に入ります:
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <span className="meta-mono">/data/yorox.db</span> — データベース(SQLite)
          </li>
          <li>
            <span className="meta-mono">/data/files/</span> —
            アップロード画像(アバター・サムネイル)
          </li>
        </ul>
        <p className="mt-2 text-sm text-neutral">
          ここさえバックアップすれば引っ越しできます(STEP 4 参照)。
        </p>
      </section>

      <NextStep slug="domain" />
    </article>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
