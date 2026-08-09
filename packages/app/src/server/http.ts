/**
 * HTTP リクエストの共通ヘルパー(全ルートで共有)。
 *
 * 公開オリジンの決定:
 * リバースプロキシ(Docker + Caddy/nginx で TLS 終端)の背後では
 * c.req.url が http://内部ホスト になり、Origin 検証・Secure cookie・
 * マジックリンク/OAuth コールバック URL がすべて壊れる。
 * PUBLIC_ORIGIN(明示)→ x-forwarded-* → c.req.url の順で解決する。
 */
import type { Context } from 'hono';

async function getEnvSafe(): Promise<Env | null> {
  try {
    const { env } = await import('cloudflare:workers');
    return env;
  } catch {
    return null;
  }
}

let cachedPublicOrigin: string | null | undefined;

async function publicOriginFromEnv(): Promise<string | null> {
  if (cachedPublicOrigin !== undefined) return cachedPublicOrigin;
  const env = await getEnvSafe();
  const raw = env?.PUBLIC_ORIGIN?.trim();
  cachedPublicOrigin = raw ? raw.replace(/\/$/, '') : null;
  return cachedPublicOrigin;
}

/** リクエストの公開オリジン(https://host)を返す */
export async function requestOrigin(c: Context): Promise<string> {
  const explicit = await publicOriginFromEnv();
  if (explicit) return explicit;
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host')?.split(',')[0]?.trim() || url.host;
  return `${proto}://${host}`;
}

/** Secure cookie を付けてよいか(公開オリジンが https か) */
export async function isSecureRequest(c: Context): Promise<boolean> {
  return (await requestOrigin(c)).startsWith('https:');
}

/**
 * POST の Origin 検証(CSRF)。同一オリジンのフォーム送信のみ受け付ける。
 * Origin ヘッダを送らない UA もあるため、未送信は許容する(cookie は SameSite=Lax)。
 */
export async function assertSameOrigin(c: Context): Promise<boolean> {
  const origin = c.req.header('origin');
  if (!origin) return true;
  return origin === (await requestOrigin(c));
}

/** フォーム値の文字列正規化(前後空白除去) */
export function formStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** フォーム値の整数化(空・非数は undefined) */
export function formInt(v: unknown): number | undefined {
  const s = formStr(v);
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? undefined : n;
}
