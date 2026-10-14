import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSafeLookup, isPublicHttpUrl, nodePinnedFetch, safeFetch } from './safe-fetch';

/** テスト用の名前解決: ホスト名 → アドレスの固定表(Node の dns.lookup と同じ呼び出し形) */
function fakeDns(table: Record<string, string[]>) {
  const calls: string[] = [];
  const lookup = (
    host: string,
    _opts: unknown,
    cb: (err: Error | null, addrs: { address: string; family: number }[]) => void,
  ) => {
    calls.push(host);
    const addrs = table[host];
    if (!addrs) return cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
    cb(null, addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  };
  return { lookup, calls };
}

const dns = vi.hoisted(() => ({ table: {} as Record<string, string[]> }));
vi.mock('node:dns', async (orig) => ({
  ...(await orig<typeof import('node:dns')>()),
  lookup: (host: string, opts: unknown, cb: never) => fakeDnsForMock(host, opts, cb),
}));
function fakeDnsForMock(host: string, opts: unknown, cb: never) {
  fakeDns(dns.table).lookup(host, opts, cb);
}


describe('isPublicHttpUrl', () => {
  it('公開 https/http を許可する', () => {
    expect(isPublicHttpUrl('https://mastodon.social/users/foo')).toBe(true);
    expect(isPublicHttpUrl('http://example.com/inbox')).toBe(true);
  });

  it('http(s) 以外のスキームを拒否する', () => {
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('gopher://evil/')).toBe(false);
    expect(isPublicHttpUrl('ftp://example.com/')).toBe(false);
  });

  it('localhost 系を拒否する', () => {
    expect(isPublicHttpUrl('http://localhost:6379/')).toBe(false);
    expect(isPublicHttpUrl('http://foo.localhost/')).toBe(false);
    expect(isPublicHttpUrl('https://printer.local/')).toBe(false);
  });

  it('プライベート/ループバック/リンクローカル IPv4 を拒否する', () => {
    expect(isPublicHttpUrl('http://127.0.0.1/')).toBe(false);
    expect(isPublicHttpUrl('http://10.0.0.5:6379/')).toBe(false);
    expect(isPublicHttpUrl('http://172.16.0.1/')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.1/')).toBe(false);
    expect(isPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isPublicHttpUrl('http://0.0.0.0/')).toBe(false);
  });

  it('公開 IPv4 は許可する', () => {
    expect(isPublicHttpUrl('http://8.8.8.8/')).toBe(true);
    expect(isPublicHttpUrl('http://172.32.0.1/')).toBe(true); // 172.16-31 の外
  });

  it('ループバック/ULA/リンクローカル IPv6 を拒否する', () => {
    expect(isPublicHttpUrl('http://[::1]/')).toBe(false);
    expect(isPublicHttpUrl('http://[fc00::1]/')).toBe(false);
    expect(isPublicHttpUrl('http://[fe80::1]/')).toBe(false);
  });

  it('壊れた URL を拒否する', () => {
    expect(isPublicHttpUrl('not a url')).toBe(false);
    expect(isPublicHttpUrl('')).toBe(false);
  });
});

describe('safeFetch', () => {
  const redirectTo = (location: string) =>
    new Response(null, { status: 302, headers: { location } });

  afterEach(() => vi.unstubAllGlobals());

  it('公開 URL 間のリダイレクトは 1 ホップずつ追う', async () => {
    vi.stubGlobal('__YOROX_TARGET__', 'cloudflare');
    const fetchMock = vi.fn(async (url: string) =>
      url === 'https://a.example/x' ? redirectTo('https://b.example/y') : new Response('ok'),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await safeFetch('https://a.example/x');
    expect(await res?.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('内部アドレスへのリダイレクトは追わずに null を返す', async () => {
    vi.stubGlobal('__YOROX_TARGET__', 'cloudflare');
    const fetchMock = vi.fn(async () => redirectTo('http://169.254.169.254/latest/meta-data'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await safeFetch('https://a.example/x')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maxRedirects=0 ならリダイレクト応答をそのまま返す', async () => {
    vi.stubGlobal('__YOROX_TARGET__', 'cloudflare');
    vi.stubGlobal('fetch', vi.fn(async () => redirectTo('https://b.example/')));
    expect((await safeFetch('https://a.example/', {}, 0))?.status).toBe(302);
  });

});

describe('createSafeLookup(接続時の名前解決で内部アドレスを拒否)', () => {
  const run = (table: Record<string, string[]>, host: string, all = false) =>
    new Promise<{ err: Error | null; address: unknown }>((resolve) =>
      createSafeLookup(fakeDns(table).lookup as never)(host, { all }, (err, address) =>
        resolve({ err, address }),
      ),
    );

  it('公開アドレスはそのまま返す', async () => {
    const r = await run({ 'a.example': ['93.184.216.34'] }, 'a.example');
    expect(r.err).toBeNull();
    expect(r.address).toBe('93.184.216.34');
  });

  it('内部アドレスに解決されれば拒否する', async () => {
    expect((await run({ 'a.example': ['169.254.169.254'] }, 'a.example')).err).not.toBeNull();
  });

  it('公開と内部が混在していれば拒否する(どれに接続されるか分からないため)', async () => {
    const r = await run({ 'a.example': ['93.184.216.34', '10.0.0.5'] }, 'a.example', true);
    expect(r.err).not.toBeNull();
  });
});

describe('nodePinnedFetch / safeFetch(Node)', () => {
  let server: Server;
  let port: number;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits++;
      if (req.url === '/empty') {
        res.writeHead(204).end();
        return;
      }
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.setHeader('set-cookie', ['a=1', 'b=2']);
        res.writeHead(201, { 'content-type': 'text/plain', 'x-method': req.method ?? '' });
        res.end(`echo:${body}`);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('応答のステータス・ヘッダ・本文と、送信本文を正しく受け渡す', async () => {
    // 接続の受け渡しだけを確かめるため、ここでは検査なしの名前解決を注入する
    const permissive = fakeDns({ 'svc.test': ['127.0.0.1'] }).lookup;
    const res = await nodePinnedFetch(
      `http://svc.test:${port}/x`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"k":1}' },
      permissive as never,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('x-method')).toBe('POST');
    expect(res.headers.get('set-cookie')).toContain('a=1');
    expect(await res.text()).toBe('echo:{"k":1}');

    const empty = await nodePinnedFetch(`http://svc.test:${port}/empty`, {}, permissive as never);
    expect(empty.status).toBe(204);
    expect(empty.body).toBeNull();
  });

  it('内部アドレスに解決されるホストには接続せず null を返す', async () => {
    vi.stubGlobal('__YOROX_TARGET__', 'node');
    dns.table = { 'rebind.example': ['127.0.0.1'] };
    const before = hits;
    expect(await safeFetch(`http://rebind.example:${port}/x`)).toBeNull();
    expect(hits).toBe(before);
  });
});
