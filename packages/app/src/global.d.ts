declare module '*.css';

// シークレット(wrangler secret / .dev.vars)は wrangler types に現れないため補完する
// 注: SLOT_COORDINATOR は wrangler types が Fetcher として生成する。
//     RPC の型付けは src/server/coordinator.ts の境界ヘルパーで行う
interface Env {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}
