# 未決事項 / 判断記録

2026-08-08 未明のスキャフォールド作業で保留した論点と、同日のユーザー判断。

## 決定済み(2026-08-08 ユーザー判断)

### 1. ローカル認証方式 → プラガブルに全対応
メールマジックリンク / パスキー(WebAuthn) / パスワード / GitHub 含むメジャーどころの OAuth
を**すべて**サポートする方針。認証方式も通知ドライバ同様のプラガブル設計にする。
実装順序は別途判断(下記「要判断」参照)。

### 2. handle の衝突 → ユーザーと個人グループの両方が handle を持てる
「ユーザー alice」と「alice の個人グループ」は同じ handle を共有する。
- DB 制約は (handle, domain, kind) 一意に緩め、**personal ペア以外の cross-kind 重複は
  アプリ層で禁止**(無関係なユーザー bob とグループ bob の共存は不可)
- webfinger は露出中のアクター(当面はグループ)を rel=self で返し、aliases に両方の URI を載せる
- 将来ユーザーアクターを公開したときの JRD 切替もこの構造で吸収できる

### 3. 先着枠の定員直列化 → 別 Worker に Durable Objects
DECISIONS.md の原案どおり DO を採用。Waku アプリ内では DO を定義できないため、
`packages/slot-coordinator` Worker に DO を置き、service binding(RPC)で app から呼ぶ。
- DO は slotId 単位でインスタンス化し、参加確定処理を直列化する
- ローカル開発で binding がない場合は D1 条件付き INSERT(実装済み)にフォールバック

### 4. イベントの人間向け URL → `/g/{handle}/events/{ulid}` 採用
現状実装を採用。ただし**より短い形式は引き続き検討**(候補: `/e/{ulid}` の短縮リダイレクト、
グループ内連番、slug)。AP URI(`/events/{ulid}`)は不変なので後からでも足せる。

### 5. 認証の実装順序 → マジックリンク → パスキー → OAuth → パスワード
MVP のログイン手段はメールマジックリンク。パスキーはマジックリンクをリカバリ経路にする。

### 6. 個人グループ → サインアップ時に自動作成(GitHub 方式)
登録完了時点で同一 handle の個人グループを作成し、本人をオーナーにする。

### 7. セッション → D1 セッションテーブル + httpOnly cookie
即時失効(ログアウト、claim 統合時の強制切断)を優先。トークンはハッシュ化して保存。

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
