# メール送信基盤

通知メールの送信は「トランスポート抽象化 + 送信キュー + レート制御」の三層で行う。

```
ドメインイベント → 通知ディスパッチャ → QueueEmailDriver → mail_queue(D1)
                                                     ↓ Cron(5分毎)
                       レート制御(分/時上限・古い順・失敗は指数バックオフ)
                                                     ↓
              MailTransport ─ ResendTransport(HTTP API)
                            └ SmtpTransport(worker-mailer / cloudflare:sockets)
```

- **マジックリンクは例外**: ユーザーが待っているためキューを通さず即時送信する
  (`src/mail/send.ts` の `createDirectSender`)。
- トランスポート未設定(`MAIL_FROM` なし)のときはキューに積まず、コンソール出力のみ。

## 設定(環境変数 / wrangler secret)

| 変数 | 説明 |
| --- | --- |
| `MAIL_FROM` | 送信元。例 `Yorox <noreply@yorox.example>`。未設定で送信無効 |
| `MAIL_TRANSPORT` | `resend` / `smtp`。未指定なら `RESEND_API_KEY` があれば resend |
| `RESEND_API_KEY` | Resend の API キー |
| `SMTP_HOST` / `SMTP_PORT` | SMTP サーバー。ポート既定 587 |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | SMTP 認証(省略可) |
| `SMTP_SECURE` | `1` で implicit TLS。既定はポート 465 なら自動で有効 |
| `SMTP_START_TLS` | `0` で STARTTLS 無効。既定は 465 以外で有効 |
| `MAIL_RATE_PER_MINUTE` | 分あたり送信上限(既定 10) |
| `MAIL_RATE_PER_HOUR` | 時あたり送信上限(既定 100) |

### Gmail で送る

SMTP トランスポートをそのまま使う:

```
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=you@gmail.com
SMTP_PASSWORD=<アプリパスワード>   # Google アカウント > セキュリティ > 2段階認証 > アプリパスワード
MAIL_FROM=you@gmail.com
```

Gmail の送信上限(個人 ~500通/日)に合わせて `MAIL_RATE_PER_HOUR` を控えめに
(例: 20)しておくとよい。将来 Gmail API(OAuth)トランスポートを追加する場合も
`MailTransport` IF に実装を足すだけでよい。

## まとめ送り(バッチ)

トランスポートが `sendBatch` を実装している場合、キュー処理は予算内の pending を
**1回の API 呼び出し**で送る。

- Resend: Batch API(`POST /emails/batch`、1リクエスト最大100通)を実装済み。
  Resend 側のリクエストレート制限(2 req/sec)にほぼ触れずに済む
- SMTP: 逐次送信(将来は1コネクションで複数通に最適化余地あり)
- バッチは「全成功 or 全失敗」のセマンティクス。失敗時は全件がバックオフ再試行に回る

## レート制御の仕様

- Cron(5分毎)が `mail_queue` の `pending` を **scheduledAt の古い順**に処理する
- 送る通数 = `min(分上限 − 直近60秒の送信数, 時上限 − 直近3600秒の送信数)`
- 失敗時は指数バックオフで再試行: 1分 → 2分 → 4分 → 8分(`scheduledAt` を先送り)
- 5回失敗で `failed`(`last_error` に最後のエラーを記録)

## 実装ファイル

- `src/mail/transport.ts` — トランスポート IF と実装、env からの構築
- `src/mail/queue.ts` — キュー投入・レート計算(純粋関数)・キュー処理
- `src/mail/send.ts` — 即時送信(マジックリンク用)
- `src/notifications/driver.ts` — `QueueEmailDriver`(通知→キュー投入)
- `src/server/scheduled.ts` — Cron でのキュー処理呼び出し

## Docker 版への移植

`MailTransport` IF は platform-free。Node ランタイムでは `SmtpTransport` を
nodemailer 実装に差し替える(worker-mailer は cloudflare:sockets 依存のため)。
