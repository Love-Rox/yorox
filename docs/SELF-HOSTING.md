# Yorox を Docker で自己ホストする

Yorox は Cloudflare(本家 yorox.love-rox.cc の構成)のほかに、
**Docker コンテナ(Node + SQLite + ローカルファイル)**でも動きます。
アプリコードは完全に共通で、ビルド時にランタイム層だけが切り替わります
(`YOROX_TARGET=node`)。

## クイックスタート

```sh
docker compose up -d
# → http://localhost:8080
```

初回起動時に SQLite のマイグレーションが自動適用されます。
データはボリューム `yorox-data`(`/data`)に保存されます:

- `/data/yorox.db` — SQLite データベース
- `/data/files/` — アップロードファイル(アバター・サムネイル)

## メール(ログインリンク)

SMTP を設定するまでは、ログインリンクが**コンテナログに出力**されます:

```sh
docker compose logs -f yorox   # [mail] ... のリンクをブラウザで開く
```

本運用では compose.yaml の SMTP 設定(`MAIL_TRANSPORT=smtp` ほか)を
有効にしてください。Gmail はアプリパスワードで利用できます。

## 公開・連合するには

ActivityPub 連合とパスキーは **HTTPS の公開 URL** が前提です。
リバースプロキシ(Caddy / nginx / Cloudflare Tunnel など)で
`https://あなたのドメイン` → `yorox:8080` を終端してください。
ドメインはアクター URI に焼き込まれるため、**運用開始後に変更しない**
ことを強く推奨します。

## Cloudflare 版との差分

| 機能 | Cloudflare | Docker |
| --- | --- | --- |
| DB | D1 | SQLite(D1 互換シム) |
| ファイル | R2 | ローカル FS(`/data/files`) |
| メール | Email Service / Resend / SMTP | SMTP(nodemailer) |
| 定期ジョブ | Cron Triggers(5分) | プロセス内タイマー(5分) |
| 先着の直列化 | Durable Object | なし(単一プロセス + SQLite の条件付き INSERT で防衛) |

## 更新

```sh
git pull
docker compose build
docker compose up -d   # マイグレーションは起動時に自動適用
```
