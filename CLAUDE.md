# Yorox

分散型イベント管理プラットフォーム(Connpass 代替、将来 ActivityPub 連合)。
設計決定は `docs/DECISIONS.md`、ID/URL 設計は `docs/URL-DESIGN.md`、
保留中の判断は `docs/OPEN-QUESTIONS.md` を必ず参照すること。

## 構成

pnpm workspaces モノレポ:
- `packages/app` — アプリ本体。Waku (RSC) + Hono、Cloudflare Workers + D1 + Drizzle
- `packages/ap` — ゼロ依存 ActivityPub ライブラリ(**ランタイム依存を追加しない**)

## コマンド(packages/app)

```sh
pnpm dev                    # Waku dev サーバー(workerd で実行、D1 バインディング有効)
pnpm build                  # Cloudflare Workers 向けビルド
pnpm start                  # wrangler dev(要事前 build。--test-scheduled で cron テスト)
pnpm typecheck / pnpm test  # ルートから全パッケージ一括も可
pnpm db:generate            # Drizzle マイグレーション生成(スキーマ変更後)
pnpm db:migrate:local       # ローカル D1 に適用
pnpm cf-typegen             # wrangler.jsonc 変更後に worker-configuration.d.ts を再生成
pnpm exec wrangler d1 execute yorox-db --local --file=./seed/dev-seed.sql  # 開発シード
```

cron のローカルテスト: `wrangler dev --test-scheduled` を起動して
`curl 'http://localhost:8799/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*'`
(`/__scheduled` ではない)。

## アーキテクチャ上の約束

- サーバーエントリは `src/waku.server.tsx`。AP エンドポイント(webfinger / inbox / nodeinfo)は
  `src/server/ap-routes.ts` の middlewareFn で Hono に直接登録(ページより先に評価される)
- Cloudflare バインディングは `import { env } from 'cloudflare:workers'`。
  シークレット(RESEND_API_KEY 等)は `src/global.d.ts` の `interface Env` 拡張に追記する
- ID は全エンティティ ULID(`src/lib/ulid.ts`、自前実装)。**AP URI に使うため再割当禁止**
- 先着枠の定員は D1 の単一ステートメント条件付き INSERT で守る(`src/domain/participation.ts`)。
  トランザクションに頼らない
- ドメインの状態遷移は必ず `emitDomainEvent`(通知 outbox)を伴わせる
- Durable Objects は Waku アプリ内で定義できない(要 service bindings)。安易に使わない

## デプロイ前の TODO

- `wrangler d1 create yorox-db` で実 ID を発行し `wrangler.jsonc` の `database_id` を置換
- `wrangler secret put RESEND_API_KEY` / `MAIL_FROM`(メール通知を使う場合)
