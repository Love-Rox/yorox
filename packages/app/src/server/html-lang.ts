/**
 * HTML レスポンスの <html> に lang 属性を付ける。
 *
 * Waku(1.0.0-beta.8)は <html> をフレームワーク内部で生成しており、
 * アプリ側から属性を足す手段が無い。lang が無いと支援技術が読み上げ言語を
 * 判断できず、ページ言語を見る外部ツール(クローラー・審査系の自動判定)にも
 * 不利なため、Cloudflare の HTMLRewriter でストリーミング中に補う。
 *
 * Waku が <html lang> を出せるようになったらこのミドルウェアは削除してよい。
 */
import type { Hono, MiddlewareHandler } from 'hono';

const LANG = 'ja';

export default function htmlLang(_opts: { app: Hono }): MiddlewareHandler {
  return async (c, next) => {
    await next();

    const res = c.res;
    if (!res || !res.body) return;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/html')) return;

    // HTMLRewriter は workerd 限定。Node 自己ホストでは何もしない
    if (typeof HTMLRewriter === 'undefined') return;

    c.res = new HTMLRewriter()
      .on('html', {
        element(el) {
          if (!el.getAttribute('lang')) el.setAttribute('lang', LANG);
        },
      })
      .transform(res);
  };
}
