import { Link } from 'waku';
import { unstable_getRequest as getRequest } from 'waku/router/server';

/** MCP(Model Context Protocol)連携ガイド */
export default async function McpGuidePage() {
  const origin = new URL(getRequest().url).origin;
  const endpoint = `${origin}/mcp`;

  return (
    <article>
      <title>MCP 連携 - Yorox</title>
      <p className="text-sm">
        <Link to="/docs" className="link">
          ← 使い方
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">MCP 連携</h1>
      <p className="mt-3 text-neutral">
        Yorox は <strong>MCP(Model Context Protocol)</strong> サーバーを内蔵しています。
        Claude をはじめとする MCP 対応の AI クライアントから、Yorox のイベントを検索・
        取得したり、あなたとしてイベントを作成・参加したりできます。
      </p>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">エンドポイント</h2>
        <p className="mt-3">
          トランスポートは <strong>Streamable HTTP</strong>(MCP 仕様 2026-07-28。
          旧版クライアントとも相互運用)です。MCP クライアントに「リモート MCP
          サーバー」として次の URL を登録してください:
        </p>
        <p className="meta-mono mt-3 rounded border border-rule bg-paper-2 p-3 break-all">
          {endpoint}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">認証(書き込み操作)</h2>
        <p className="mt-3">
          <strong>読み取り</strong>ツール(イベント検索・取得)は認証不要です。
          <strong>書き込み</strong>ツール(作成・参加・キャンセル)には
          <strong>アクセストークン</strong>が必要です。
        </p>
        <ol className="mt-3 list-inside list-decimal space-y-1">
          <li>
            <Link to="/settings/profile" className="link">
              プロフィール設定
            </Link>
            の「アクセストークン」でトークンを発行(発行時に一度だけ表示)
          </li>
          <li>
            MCP クライアントの HTTP ヘッダに{' '}
            <span className="meta-mono">Authorization: Bearer &lt;token&gt;</span> を設定
          </li>
        </ol>
        <p className="mt-3 text-sm text-neutral">
          トークンはあなた本人としての操作に使われます。第三者に共有しないでください。
          不要になったら設定画面からいつでも失効できます。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">使えるツール</h2>

        <h3 className="mt-5 font-bold">読み取り(認証不要)</h3>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
          <li>
            <span className="meta-mono">list_upcoming_events</span> — 今後の公開イベント一覧
          </li>
          <li>
            <span className="meta-mono">search_events</span> — キーワードで公開イベントを検索
          </li>
          <li>
            <span className="meta-mono">get_event</span> — イベント詳細(枠の空き・セッション)
          </li>
          <li>
            <span className="meta-mono">list_group_events</span> — グループの公開イベント一覧
          </li>
        </ul>

        <h3 className="mt-5 font-bold">書き込み(要トークン)</h3>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
          <li>
            <span className="meta-mono">list_my_participations</span> — 自分の参加状況一覧
          </li>
          <li>
            <span className="meta-mono">create_event</span> — 自分が権限を持つグループに下書き
            イベントを作成(公開は Web の編集画面から)
          </li>
          <li>
            <span className="meta-mono">join_slot</span> — 参加枠に申込(結果は accepted /
            waitlisted / applied)
          </li>
          <li>
            <span className="meta-mono">cancel_participation</span> — 自分の参加をキャンセル
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="display border-b-2 border-ink pb-2 t-md">設定例</h2>
        <p className="mt-3">
          クライアントによって設定方法は異なりますが、リモート MCP サーバー(Streamable
          HTTP)として URL と認証ヘッダを指定する形が一般的です。例(JSON 設定の場合):
        </p>
        <pre className="meta-mono mt-3 overflow-x-auto rounded border border-rule bg-paper-2 p-3 text-sm">
          {`{
  "mcpServers": {
    "yorox": {
      "url": "${endpoint}",
      "headers": { "Authorization": "Bearer <あなたのトークン>" }
    }
  }
}`}
        </pre>
        <p className="mt-3 text-sm text-neutral">
          認証ヘッダを省略すると読み取りツールのみ利用できます。
        </p>
      </section>
    </article>
  );
}

export const getConfig = async () => {
  return { render: 'dynamic' } as const;
};
