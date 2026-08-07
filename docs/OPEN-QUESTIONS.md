# 未決事項 / 夜間作業での仮判断

2026-08-08 未明のスキャフォールド作業で保留・仮決めした論点。**要レビュー**。

## 要判断(ユーザー確認待ち)

### 1. ローカル認証方式
`users` テーブルは `email` + `email_verified_at` のみ用意した。認証方式は未実装。
候補:
- **メールマジックリンク**(通知でどのみち Resend 等を使う。パスワードレス) ← 仮おすすめ
- パスワード認証(古典的、オフラインでも動く)
- パスキー(WebAuthn。モダンだが実装コスト高、リカバリ設計が必要)
- GitHub 等の OAuth(技術イベント文化圏には合うが中央依存)

### 2. handle の衝突: ユーザー vs 個人グループ
handle はユーザー/グループ単一名前空間(GitHub 方式)としたが、
「ユーザー alice」と「alice の個人グループ」が同じ handle を使えない。
候補:
- 個人グループが handle を持ち、ユーザーアクターは handle なし(URI のみ予約)← 仮採用
- ユーザーが handle を持ち、個人グループは `alice-group` 等の派生名
- 同一 handle を両者で共有(webfinger は露出中のアクターを返す)
DECISIONS.md の「将来ユーザーアクター公開時に統合するか併存させるか保留」と直結する。

### 3. 先着枠の定員直列化と Durable Objects
DECISIONS.md では DO で先着枠を直列化する方針だが、**Waku アプリ内では DO を定義できない**
(公式ガイド明記。service bindings で別 Worker に置く必要がある)。
候補:
- 別 Worker(`packages/slot-coordinator` 等)に DO を置き service binding で呼ぶ
- MVP は D1 の条件付き UPDATE(楽観ロック)で済ませ、DO は連合対応時に導入 ← 仮おすすめ
  (D1 は単一書き込みなので、`UPDATE ... WHERE 定員未満` の原子性で MVP 規模は守れる)

### 4. イベントの人間向け URL
`/g/{handle}/events/{ulid}` と仮置き(ULID がそのまま見える)。
Connpass 風の連番(`/event/12345`)や slug を使うかは UI 設計時に判断。
AP URI(`/events/{ulid}`)は不変なのでどちらでも壊れない。

## 仮判断(異議なければこのまま)

| 論点 | 仮判断 | 理由 |
| --- | --- | --- |
| ロール権限の表現 | 権限フラグ文字列の JSON 配列(ビットフラグではなく) | D1/Drizzle で可読・拡張容易。行数が小さく性能差は無視できる |
| ID 生成 | 自前 ULID 実装(`src/lib/ulid.ts`、ゼロ依存) | 依存を増やさない。Workers の `crypto` のみ使用 |
| `@yorox/ap` の配布形態 | TS ソース直 export(ビルドなし、アプリ側でバンドル) | モノレポ内専用のうちは DX 優先。外部公開時に tsup 等を導入 |
| visibility | MVP は `draft` / `public` の2値 | 限定公開(unlisted)等は連合設計と絡むので後回し |
| タイムスタンプ | epoch ミリ秒の INTEGER(`timestamp_ms`) | SQLite 慣行。タイムゾーンはイベント側に IANA 名で保持 |
| wrangler の D1 `database_id` | プレースホルダ UUID | 本番デプロイ前に `wrangler d1 create yorox-db` で置換が必要 |
| 通知 outbox | `domain_events` テーブル + `processed_at` ポーリング | MVP はメール1本なので Queues 導入前の最小構成 |

## 実装状況メモ

- webfinger は D1 実データを解決する(ローカル actors の handle 一致)。動作確認済み。
- `/inbox` 系は URL 予約のみで 501 応答。
- nodeinfo 2.1 は最小実装(usage 等は空)。
- 抽選・繰上の Cron Triggers、メールドライバは未着手。
