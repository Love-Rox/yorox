/**
 * クローラー(Googlebot 等)のアクセスをログに残す軽量ミドルウェア。
 * Workers Observability で `[crawl]` を検索すれば到来を確認できる。
 * ボット系 User-Agent のときだけ出力するので通常リクエストには影響しない。
 */
import type { Hono, MiddlewareHandler } from 'hono';

const BOT_UA = /googlebot|google-inspectiontool|bingbot|duckduckbot|crawl|spider|slurp/i;

/**
 * ログ偽装(改行・制御文字の注入)を防ぐため、制御文字を空白に置換し長さを制限する。
 * User-Agent は攻撃者が自由に設定できるため、そのままログに出さない。
 */
function sanitizeForLog(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
    if (out.length >= 300) break;
  }
  return out;
}

export default function crawlLog(_opts: { app: Hono }): MiddlewareHandler {
  return async (c, next) => {
    const ua = c.req.header('user-agent') ?? '';
    if (BOT_UA.test(ua)) {
      const path = sanitizeForLog(new URL(c.req.url).pathname);
      console.log(`[crawl] ${c.req.method} ${path} ua="${sanitizeForLog(ua)}"`);
    }
    return next();
  };
}
