declare module '*.css';

// シークレット(wrangler secret / .dev.vars)は wrangler types に現れないため補完する
interface Env {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}
