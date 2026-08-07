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

## 実装状況メモ(2026-08-08 未明時点)

動作確認済み(wrangler dev + ローカル D1):
- webfinger(D1 実データ解決)、nodeinfo 2.1 最小実装、`/inbox` 系は URL 予約のみ 501
- 閲覧ページ: トップ(イベント一覧)/ `/g/[handle]` / `/g/[handle]/events/[id]`、404
- Cron Trigger(5分毎)→ 締切超過の抽選枠を自動実行 → domain_events → ディスパッチャ
  → コンソールドライバ通知、の一連をエンドツーエンドで確認
- テスト 29 件(ap 10 + app 19)、typecheck / build 通過

実装済みだが未検証・未接続:
- 先着枠の原子的 join / キャンセル繰上 / 承諾型繰上(コードはあるが UI・認証がなく呼び出せない)
- Resend ドライバ(APIキー未設定。`.dev.vars.example` 参照)
- グループ作成サービス(UI なし)

未着手:
- 認証・セッション(要判断 #1 に依存)、イベント作成/申込 UI、Markdown レンダリング、
  出欠管理 UI、手動抽選 UI、AP 連合一式
