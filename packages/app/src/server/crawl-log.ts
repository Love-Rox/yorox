/**
 * クローラー(Googlebot 等)のアクセスをログに残す軽量ミドルウェア。
 * Workers Observability で `[crawl]` を検索すれば到来を確認できる。
 * ボット系 User-Agent のときだけ出力するので通常リクエストには影響しない。
 */
import type { Hono, MiddlewareHandler } from 'hono';

const BOT_UA = /googlebot|google-inspectiontool|bingbot|duckduckbot|crawl|spider|slurp/i;

export default function crawlLog(_opts: { app: Hono }): MiddlewareHandler {
  return async (c, next) => {
    const ua = c.req.header('user-agent') ?? '';
    if (BOT_UA.test(ua)) {
      const url = new URL(c.req.url);
      console.log(`[crawl] ${c.req.method} ${url.pathname} ua="${ua}"`);
    }
    return next();
  };
}
