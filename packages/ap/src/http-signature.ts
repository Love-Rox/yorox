/**
 * HTTP Signatures(draft-cavage-http-signatures-12、Fediverse 事実上標準)の
 * 署名・検証。WebCrypto のみ使用(ゼロ依存)。
 *
 * 署名対象は (request-target) host date digest を既定とする。
 */

const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function importPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', pemToDer(pem), ALGO, false, ['verify']);
}

export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pemToDer(pem), ALGO, false, ['sign']);
}

function b64encode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function b64decode(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** ボディの SHA-256 Digest ヘッダ値を作る */
export async function computeDigest(body: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return `SHA-256=${b64encode(hash)}`;
}

/** 署名文字列を組み立てる */
export function buildSigningString(
  method: string,
  path: string,
  headers: Record<string, string>,
  headerNames: string[],
): string {
  return headerNames
    .map((name) => {
      if (name === '(request-target)') {
        return `(request-target): ${method.toLowerCase()} ${path}`;
      }
      const value = headers[name.toLowerCase()];
      if (value === undefined) throw new Error(`missing header for signing: ${name}`);
      return `${name}: ${value}`;
    })
    .join('\n');
}

export interface SignRequestInput {
  method: string;
  url: string;
  /** GET など本文なしのリクエストは省略(Digest を署名対象に含めない) */
  body?: string;
  /** 例: https://host/groups/{ulid}#main-key */
  keyId: string;
  privateKeyPem: string;
}

/**
 * 送信リクエストに付与するヘッダ一式(Date / Digest / Signature / Host)を作る。
 * body 省略時は署名付き GET(signed fetch)用に Digest を含めない。
 */
export async function signRequest(input: SignRequestInput): Promise<Record<string, string>> {
  const url = new URL(input.url);
  const date = new Date().toUTCString();
  const headerNames = ['(request-target)', 'host', 'date'];
  const headers: Record<string, string> = {
    host: url.host,
    date,
  };
  if (input.body !== undefined) {
    headerNames.push('digest');
    headers.digest = await computeDigest(input.body);
  }
  const signingString = buildSigningString(
    input.method,
    url.pathname + url.search,
    headers,
    headerNames,
  );
  const key = await importPrivateKey(input.privateKeyPem);
  const signature = await crypto.subtle.sign(
    ALGO.name,
    key,
    new TextEncoder().encode(signingString),
  );
  return {
    ...headers,
    signature: [
      `keyId="${input.keyId}"`,
      'algorithm="rsa-sha256"',
      `headers="${headerNames.join(' ')}"`,
      `signature="${b64encode(signature)}"`,
    ].join(','),
  };
}

export interface ParsedSignature {
  keyId: string;
  algorithm?: string;
  headers: string[];
  signature: string;
}

/** Signature ヘッダをパースする。不正なら null */
export function parseSignatureHeader(header: string): ParsedSignature | null {
  const params: Record<string, string> = {};
  for (const match of header.matchAll(/(\w+)="([^"]*)"/g)) {
    params[match[1]!] = match[2]!;
  }
  if (!params.keyId || !params.signature) return null;
  const parsed: ParsedSignature = {
    keyId: params.keyId,
    headers: (params.headers ?? 'date').split(/\s+/),
    signature: params.signature,
  };
  if (params.algorithm !== undefined) parsed.algorithm = params.algorithm;
  return parsed;
}

export interface VerifyRequestInput {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  parsed: ParsedSignature;
  publicKeyPem: string;
}

/**
 * 受信リクエストの署名と Digest を検証する。
 * @returns 妥当なら true
 */
export async function verifyRequest(input: VerifyRequestInput): Promise<boolean> {
  // Digest 検証(署名対象に含まれる場合のみ必須)
  if (input.parsed.headers.includes('digest')) {
    const expected = await computeDigest(input.body);
    if (input.headers['digest'] !== expected) return false;
  }
  const signingString = buildSigningString(
    input.method,
    input.path,
    input.headers,
    input.parsed.headers,
  );
  const key = await importPublicKey(input.publicKeyPem);
  try {
    return await crypto.subtle.verify(
      ALGO.name,
      key,
      b64decode(input.parsed.signature),
      new TextEncoder().encode(signingString),
    );
  } catch {
    return false;
  }
}
