import { describe, expect, it } from 'vitest';
import { isPublicHttpUrl } from './safe-fetch';

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
