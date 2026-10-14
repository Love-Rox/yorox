/**
 * 送信先 URL の安全性チェック(SSRF 防御)。
 *
 * リモートアクターの取得・配信・webfinger など、外部から来た URL を
 * fetch する経路で使う。http(s) 以外のスキームと、ループバック/プライベート/
 * リンクローカルな IP リテラル・localhost を拒否する。
 *
 * ホスト名が内部 IP に解決される DNS リベインディングは Workers 上では
 * 名前解決できないため完全には防げないが、直接 IP 指定・localhost・
 * 非 http スキームという実際に悪用しやすい経路を塞ぐ。
 */

function isBlockedIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const oct = m.slice(1).map(Number);
  if (oct.some((n) => n > 255)) return true; // 不正な IPv4 は拒否
  const a = oct[0]!;
  const b = oct[1]!;
  if (a === 0 || a === 127) return true; // 0.0.0.0/8, ループバック
  if (a === 10) return true; // プライベート
  if (a === 172 && b >= 16 && b <= 31) return true; // プライベート
  if (a === 192 && b === 168) return true; // プライベート
  if (a === 169 && b === 254) return true; // リンクローカル(メタデータ含む)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isBlockedIpv6(host: string): boolean {
  // URL.hostname は IPv6 を [::1] のようにブラケット付きで返すため外す
  const h = host.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === '::1' || h === '::') return true; // ループバック・未指定
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA fc00::/7
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb'))
    return true; // リンクローカル fe80::/10
  if (h.startsWith('::ffff:')) return true; // IPv4 マップド
  return false;
}

/** fetch してよい公開 http(s) URL か */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (isBlockedIpv4(host)) return false;
  if (host.includes(':') && isBlockedIpv6(host)) return false;
  return true;
}

/** IP アドレス(リテラル)が内部向けか */
function isBlockedAddress(ip: string): boolean {
  return ip.includes(':') ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

/** 名前解決の結果が内部アドレスだったことを示すエラー */
class BlockedAddressError extends Error {
  readonly code = 'EBLOCKEDADDR';
}

type LookupAddress = { address: string; family: number };
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;
type LookupFn = (
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: LookupCallback,
) => void;

/**
 * 接続時に使う名前解決関数。解決した全アドレスを検査し、内部アドレスが
 * 1 つでも含まれれば接続させない。検査した結果そのものを接続に使うため、
 * 検査と接続の間に DNS の応答を差し替える DNS リバインディングも防げる。
 */
export function createSafeLookup(dnsLookup: LookupFn): LookupFn {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '');
      const list = addresses as LookupAddress[];
      if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
        return callback(new BlockedAddressError(`blocked address for ${hostname}`), '');
      }
      if (options.all) return callback(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

/** 本文を持てないステータス(Response のコンストラクタが本文付きを拒否する) */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/**
 * Node 用の fetch。node:http(s) の lookup に createSafeLookup を渡し、
 * 実際に接続する IP を検査済みのものに固定する。リダイレクトは追わない。
 * 本文は文字列のみ対応(このモジュールの呼び出し元は JSON 文字列しか送らない)。
 */
export async function nodePinnedFetch(
  url: string,
  init: RequestInit = {},
  lookup?: LookupFn,
): Promise<Response> {
  const target = new URL(url);
  const http = await import(target.protocol === 'https:' ? 'node:https' : 'node:http');
  const { Readable } = await import('node:stream');
  const safeLookup = lookup ?? createSafeLookup((await import('node:dns')).lookup as LookupFn);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const body = typeof init.body === 'string' ? init.body : undefined;
  if (init.body != null && body === undefined) throw new TypeError('unsupported body type');

  return new Promise<Response>((resolve, reject) => {
    const req = http.request(
      target,
      {
        method: init.method ?? 'GET',
        headers,
        lookup: safeLookup,
        signal: init.signal ?? undefined,
      },
      (res: import('node:http').IncomingMessage) => {
        const resHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) for (const item of v) resHeaders.append(k, item);
          else if (v !== undefined) resHeaders.set(k, String(v));
        }
        const status = res.statusCode ?? 502;
        const resBody = NULL_BODY_STATUS.has(status)
          ? (res.resume(), null)
          : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
        resolve(new Response(resBody, { status, statusText: res.statusMessage ?? '', headers: resHeaders }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * 外部 URL への fetch(SSRF 防御つき)。リダイレクトは自動で追わず、
 * 1 ホップごとに接続先を検証し直す(公開 URL から内部へのリダイレクトを防ぐ)。
 * 安全でない宛先なら null を返す。maxRedirects=0 ならリダイレクト応答をそのまま返す。
 *
 * Workers の fetch はプライベートネットワークへ到達しないため URL 検査のみで足りる。
 * Node(セルフホスト)では nodePinnedFetch で、接続に使う IP そのものを検査する。
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response | null> {
  let current = url;
  for (let hop = 0; ; hop++) {
    if (!isPublicHttpUrl(current)) return null;
    let res: Response;
    try {
      res =
        __YOROX_TARGET__ === 'node'
          ? await nodePinnedFetch(current, init)
          : await fetch(current, { ...init, redirect: 'manual' });
    } catch (err) {
      if (err instanceof BlockedAddressError) return null;
      throw err;
    }
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location || hop >= maxRedirects) return res;
    await res.body?.cancel();
    current = new URL(location, current).toString();
  }
}
