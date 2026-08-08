import { describe, expect, it } from 'vitest';
import {
  computeDigest,
  parseSignatureHeader,
  signRequest,
  verifyRequest,
} from './http-signature';

function toPem(buffer: ArrayBuffer, label: string): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const lines = b64.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  return {
    publicKeyPem: toPem(await crypto.subtle.exportKey('spki', pair.publicKey), 'PUBLIC KEY'),
    privateKeyPem: toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey), 'PRIVATE KEY'),
  };
}

describe('parseSignatureHeader', () => {
  it('keyId / headers / signature をパースする', () => {
    const parsed = parseSignatureHeader(
      'keyId="https://example.com/actor#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="c2ln"',
    );
    expect(parsed).toEqual({
      keyId: 'https://example.com/actor#main-key',
      algorithm: 'rsa-sha256',
      headers: ['(request-target)', 'host', 'date', 'digest'],
      signature: 'c2ln',
    });
  });

  it('headers 省略時は date のみ', () => {
    const parsed = parseSignatureHeader('keyId="k",signature="s"');
    expect(parsed?.headers).toEqual(['date']);
  });

  it('必須パラメータ欠落は null', () => {
    expect(parseSignatureHeader('algorithm="rsa-sha256"')).toBeNull();
  });
});

describe('signRequest / verifyRequest', () => {
  it('署名して検証できる(ラウンドトリップ)', async () => {
    const keys = await generateKeyPair();
    const body = JSON.stringify({ type: 'Follow', actor: 'https://remote.example/u/a' });
    const headers = await signRequest({
      method: 'POST',
      url: 'https://yorox.example/groups/01ABC/inbox',
      body,
      keyId: 'https://remote.example/u/a#main-key',
      privateKeyPem: keys.privateKeyPem,
    });
    expect(headers.digest).toBe(await computeDigest(body));

    const parsed = parseSignatureHeader(headers.signature!)!;
    expect(parsed.keyId).toBe('https://remote.example/u/a#main-key');
    const ok = await verifyRequest({
      method: 'POST',
      path: '/groups/01ABC/inbox',
      headers,
      body,
      parsed,
      publicKeyPem: keys.publicKeyPem,
    });
    expect(ok).toBe(true);
  });

  it('ボディ改竄で Digest 不一致 → 検証失敗', async () => {
    const keys = await generateKeyPair();
    const headers = await signRequest({
      method: 'POST',
      url: 'https://yorox.example/inbox',
      body: '{"a":1}',
      keyId: 'https://remote.example/u/a#main-key',
      privateKeyPem: keys.privateKeyPem,
    });
    const parsed = parseSignatureHeader(headers.signature!)!;
    const ok = await verifyRequest({
      method: 'POST',
      path: '/inbox',
      headers,
      body: '{"a":2}',
      parsed,
      publicKeyPem: keys.publicKeyPem,
    });
    expect(ok).toBe(false);
  });

  it('別の鍵では検証失敗', async () => {
    const keys = await generateKeyPair();
    const other = await generateKeyPair();
    const body = '{}';
    const headers = await signRequest({
      method: 'POST',
      url: 'https://yorox.example/inbox',
      body,
      keyId: 'https://remote.example/u/a#main-key',
      privateKeyPem: keys.privateKeyPem,
    });
    const parsed = parseSignatureHeader(headers.signature!)!;
    const ok = await verifyRequest({
      method: 'POST',
      path: '/inbox',
      headers,
      body,
      parsed,
      publicKeyPem: other.publicKeyPem,
    });
    expect(ok).toBe(false);
  });

  it('署名対象ヘッダの改竄(date 差し替え)で検証失敗', async () => {
    const keys = await generateKeyPair();
    const body = '{}';
    const headers = await signRequest({
      method: 'POST',
      url: 'https://yorox.example/inbox',
      body,
      keyId: 'https://remote.example/u/a#main-key',
      privateKeyPem: keys.privateKeyPem,
    });
    const parsed = parseSignatureHeader(headers.signature!)!;
    const ok = await verifyRequest({
      method: 'POST',
      path: '/inbox',
      headers: { ...headers, date: new Date(0).toUTCString() },
      body,
      parsed,
      publicKeyPem: keys.publicKeyPem,
    });
    expect(ok).toBe(false);
  });
});
