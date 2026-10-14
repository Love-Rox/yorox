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

/**
 * 接続先として安全か。Node(セルフホスト)ではホスト名を実際に名前解決し、
 * 内部 IP に解決されるドメイン(DNS で 127.0.0.1 や 169.254.169.254 を返す等)も拒否する。
 * Workers の fetch はプライベートネットワークへ到達しないため、URL 検査のみで足りる。
 */
async function isSafeDestination(raw: string): Promise<boolean> {
  if (!isPublicHttpUrl(raw)) return false;
  if (__YOROX_TARGET__ !== 'node') return true;
  try {
    const { lookup } = await import('node:dns/promises');
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isBlockedAddress(a.address));
  } catch {
    return false;
  }
}

/**
 * 外部 URL への fetch(SSRF 防御つき)。リダイレクトは自動で追わず、
 * 1 ホップごとに接続先を検証し直す(公開 URL から内部へのリダイレクトを防ぐ)。
 * 安全でない宛先なら null を返す。maxRedirects=0 ならリダイレクト応答をそのまま返す。
 *
 * 注: Node では検証後の接続時に改めて名前解決されるため、TTL 0 の DNS
 * リバインディングまでは防げない(検証と接続の間の入れ替え)。
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response | null> {
  let current = url;
  for (let hop = 0; ; hop++) {
    if (!(await isSafeDestination(current))) return null;
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location || hop >= maxRedirects) return res;
    current = new URL(location, current).toString();
  }
}
