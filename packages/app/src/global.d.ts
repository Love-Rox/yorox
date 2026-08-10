declare module '*.css';

// ビルド時に waku.config.ts の define で注入される
declare const __YOROX_VERSION__: string;
/** ビルドターゲット('cloudflare' | 'node')。waku.config の define で注入 */
declare const __YOROX_TARGET__: string;
declare const __YOROX_COMMIT__: string;

// シークレット(wrangler secret / .dev.vars)は wrangler types に現れないため補完する
// 注: SLOT_COORDINATOR は wrangler types が Fetcher として生成する。
//     RPC の型付けは src/server/coordinator.ts の境界ヘルパーで行う
interface Env {
  /** 'cloudflare' | 'resend' | 'smtp'。未指定時は RESEND_API_KEY があれば resend */
  MAIL_TRANSPORT?: string;
  /** 送信元(例: Yorox <noreply@yorox.example>)。未設定ならメール送信無効 */
  MAIL_FROM?: string;
  RESEND_API_KEY?: string;
  /** 公開オリジン(https://host)。リバースプロキシ背後で必須。未設定は x-forwarded-* / URL から推定 */
  PUBLIC_ORIGIN?: string;
  /** '1' でセルフホストガイド(/docs/self-hosting)を表示(公式鯖向けオプトイン) */
  SELF_HOSTING_GUIDE?: string;
  /** OAuth ログイン(未設定のプロバイダはログイン画面に出ない) */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  /**
   * Discord Bot トークン(任意)。設定すると Discord 連携済みユーザーへ
   * DM で通知を送る。Bot と共通のサーバーに居ないユーザーには届かない。
   */
  DISCORD_BOT_TOKEN?: string;
  /** Stripe Connect(グループ口座での決済)。未設定なら Stripe 機能は無効 */
  STRIPE_SECRET_KEY?: string;
  STRIPE_CONNECT_CLIENT_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** 法的ページ・フッター用のインスタンス情報(任意) */
  INSTANCE_NAME?: string;
  LEGAL_OPERATOR?: string;
  LEGAL_CONTACT?: string;
  /** 問い合わせフォームの送信先。設定すると /contact が有効になる */
  CONTACT_EMAIL?: string;
  /** Cloudflare Turnstile。両方設定すると問い合わせフォームに bot 対策が付く */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** サイト管理者のローカル handle(カンマ区切り)。全体の監査ログを閲覧できる */
  SITE_ADMIN_HANDLES?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  /** '1' で implicit TLS(465)。既定はポートから推定 */
  SMTP_SECURE?: string;
  /** '0' で STARTTLS 無効。既定は 465 以外で有効 */
  SMTP_START_TLS?: string;
  /** 送信レート上限。既定 10/分・100/時 */
  MAIL_RATE_PER_MINUTE?: string;
  MAIL_RATE_PER_HOUR?: string;
  /** '1' でファイルアップロード有効(R2 バインディング FILES が必要) */
  FILE_UPLOADS?: string;
  /** アップロード容量上限 MB(既定 5) */
  MAX_UPLOAD_MB?: string;
}
