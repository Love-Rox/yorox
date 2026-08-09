import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { Cmd, isGuideEnabled } from '../../../components/selfhost-guide';

/** セルフホストガイド STEP 4: 運用する */
export default async function SelfHostingOperationsPage() {
  if (!(await isGuideEnabled())) return notFound();

  return (
    <article className="max-w-[70ch]">
      <title>STEP 4: 運用する - Yorox</title>
      <p className="text-sm">
        <Link to="/docs/self-hosting" className="link">
          ← 自分のサーバーで運営する
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">STEP 4: 運用する</h1>

      <section className="mt-6">
        <h2 className="display border-b-2 border-ink pb-2 t-md">更新</h2>
        <Cmd>{`git pull
docker compose build
docker compose up -d   # データベースの変更(マイグレーション)は起動時に自動適用`}</Cmd>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">バックアップ</h2>
        <p className="mt-3">
          守るべきものは <span className="meta-mono">/data</span> ボリュームだけです:
        </p>
        <Cmd>{`# バックアップ(tar に固める)
docker run --rm -v yorox-data:/data -v "$PWD":/backup alpine \\
  tar czf /backup/yorox-backup.tar.gz -C /data .

# 復元(新しい環境で)
docker run --rm -v yorox-data:/data -v "$PWD":/backup alpine \\
  tar xzf /backup/yorox-backup.tar.gz -C /data`}</Cmd>
        <p className="mt-2 text-sm text-neutral">
          定期実行は cron 等で。SQLite は起動中でもコピーできますが、
          確実を期すなら一時停止(docker compose stop)してから取るのが安全です。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">ログの見方</h2>
        <Cmd>{`docker compose logs -f yorox
# [mail]      … メール(SMTP 未設定時はログインリンクがここに出る)
# [scheduled] … 5分毎の定期ジョブ(抽選・通知・予約公開・連合配信)
# [ap]        … Fediverse への配信
# [node]      … 起動・マイグレーション`}</Cmd>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">よくあるトラブル</h2>
        <div className="mt-3 space-y-4">
          <div className="border border-rule p-3">
            <p className="font-bold">ログインリンクのメールが届かない</p>
            <p className="mt-1 text-sm">
              SMTP 未設定ならログに出ています(上記)。設定済みなら SMTP_HOST /
              PASSWORD を確認。Gmail は通常のパスワードではなく
              <strong>アプリパスワード</strong>が必要です。
            </p>
          </div>
          <div className="border border-rule p-3">
            <p className="font-bold">Misskey / Mastodon から見つからない</p>
            <p className="mt-1 text-sm">
              HTTPS で公開できているか(STEP 2)、
              <span className="meta-mono">
                https://ドメイン/.well-known/webfinger?resource=acct:ハンドル@ドメイン
              </span>
              が JSON を返すかを確認してください。リバースプロキシが
              Host ヘッダを書き換えていないことも重要です。
            </p>
          </div>
          <div className="border border-rule p-3">
            <p className="font-bold">画像がアップロードできない</p>
            <p className="mt-1 text-sm">
              <span className="meta-mono">FILE_UPLOADS: '1'</span> が設定されているか、
              ファイルサイズが <span className="meta-mono">MAX_UPLOAD_MB</span> 以下かを
              確認してください。
            </p>
          </div>
          <div className="border border-rule p-3">
            <p className="font-bold">パスキーが登録できない</p>
            <p className="mt-1 text-sm">
              パスキーは HTTPS(または localhost)でのみ動作します。
              ドメイン公開後にお試しください。
            </p>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">困ったら</h2>
        <p className="mt-3">
          <a
            href="https://github.com/Love-Rox/yorox/issues"
            className="link meta-mono"
            rel="noreferrer"
            target="_blank"
          >
            github.com/Love-Rox/yorox/issues
          </a>
          へどうぞ。ログの該当箇所を添えていただけると助かります。
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
