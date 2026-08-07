# Yorox

分散型イベント管理プラットフォーム(寄合 + Rox)。Connpass の代替を目指し、将来的に ActivityPub による連合に対応する。

設計決定の記録は [docs/DECISIONS.md](docs/DECISIONS.md) を参照。

## 構成

pnpm workspaces によるモノレポ。

| パッケージ | 役割 |
| --- | --- |
| `packages/app` | アプリ本体。Waku (RSC) + Hono。Cloudflare Workers で動作 |
| `packages/ap` | ゼロ依存の ActivityPub ライブラリ |

## 技術スタック

- **ランタイム**: Cloudflare Workers(D1 / Queues / Durable Objects / Cron Triggers / R2)
- **フロントエンド**: Waku (React Server Components)
- **HTTP層**: Hono(AP エンドポイント `/inbox`、`/.well-known/webfinger` 等を同居)
- **データ層**: D1 + Drizzle ORM

## 開発

```sh
pnpm install
pnpm dev
```

## MVP スコープ

**成功条件: 単体で Connpass 代替として、自分のイベントを 1 つ開催しきれること。**

含む: ローカルアカウント / 先着・抽選・補欠のフル枠ポリシー / グループ+カスタムロール / Markdown 本文+資料リンク+セッション構造 / メール通知。

後回し: AP 連合一式、アグリゲータプロトコル、Web Push / Webhook、資料ファイルホスティング。ただし連合前提の ID / URL 設計は MVP 時点で守る。
