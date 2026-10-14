import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicHttpUrl, safeFetch } from './safe-fetch';

vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) =>
    host === 'internal.example'
      ? [{ address: '127.0.0.1', family: 4 }]
      : [{ address: '93.184.216.34', family: 4 }],
}));

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

  it('Node では内部 IP に解決されるホスト名を拒否し、公開 IP なら通す', async () => {
    vi.stubGlobal('__YOROX_TARGET__', 'node');
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await safeFetch('https://internal.example/')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await safeFetch('https://public.example/'))?.ok).toBe(true);
  });
});
