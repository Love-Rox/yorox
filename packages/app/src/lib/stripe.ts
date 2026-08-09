/**
 * Stripe Connect(Standard アカウント)クライアント。ゼロ依存・fetch のみ。
 *
 * 決済はグループ自身の Stripe アカウントで直接受ける(direct charge)。
 * インスタンス運営者はプラットフォームアカウントの鍵を持つだけで、
 * 売上は各グループの口座に入る(docs/DECISIONS.md 支払いの縫い目)。
 *
 * 有効化に必要な env:
 * - STRIPE_SECRET_KEY       … プラットフォームのシークレットキー
 * - STRIPE_CONNECT_CLIENT_ID… Connect の OAuth クライアント ID
 * - STRIPE_WEBHOOK_SECRET   … webhook 署名シークレット
 */

const API_BASE = 'https://api.stripe.com';
const CONNECT_BASE = 'https://connect.stripe.com';

/** プラットフォーム決済が使えるか(Checkout 作成に必要) */
export function stripeConfigured(env: Env): boolean {
  return !!env.STRIPE_SECRET_KEY;
}

/** グループが Stripe を接続できるか(Connect OAuth に必要) */
export function stripeConnectConfigured(env: Env): boolean {
  return !!env.STRIPE_SECRET_KEY && !!env.STRIPE_CONNECT_CLIENT_ID;
}

/** ネストしたパラメータを Stripe 形式(a[b][c]=v)の application/x-www-form-urlencoded に変換 */
export function encodeStripeForm(
  params: Record<string, unknown>,
  prefix = '',
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const nested = encodeStripeForm(value as Record<string, unknown>, name);
      if (nested) parts.push(nested);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === 'object') {
          parts.push(encodeStripeForm(v as Record<string, unknown>, `${name}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(v))}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

interface StripeRequestOpts {
  /** 接続済みアカウント上で実行する(direct charge) */
  stripeAccount?: string;
}

async function stripeRequest<T>(
  env: Env,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, unknown> = {},
  opts: StripeRequestOpts = {},
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (opts.stripeAccount) headers['stripe-account'] = opts.stripeAccount;
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(15_000) };
  if (method === 'POST') init.body = encodeStripeForm(params);
  const res = await fetch(`${API_BASE}${path}`, init);
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`Stripe ${path} failed: ${data.error?.message ?? res.status}`);
  }
  return data;
}

/** Connect OAuth: 認可 code を接続アカウント ID に交換する */
export async function exchangeConnectCode(
  env: Env,
  code: string,
): Promise<{ stripeUserId: string } | null> {
  try {
    const res = await fetch(`${CONNECT_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: encodeStripeForm({
        client_secret: env.STRIPE_SECRET_KEY,
        grant_type: 'authorization_code',
        code,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as { stripe_user_id?: string };
    return data.stripe_user_id ? { stripeUserId: data.stripe_user_id } : null;
  } catch {
    return null;
  }
}

/** Connect OAuth の認可 URL */
export function connectAuthorizeUrl(env: Env, state: string, redirectUri: string): string {
  return `${CONNECT_BASE}/oauth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: env.STRIPE_CONNECT_CLIENT_ID!,
    scope: 'read_write',
    redirect_uri: redirectUri,
    state,
    'stripe_user[business_type]': 'individual',
  })}`;
}

export interface CheckoutInput {
  stripeAccount: string;
  amount: number;
  currency: string;
  productName: string;
  paymentId: string;
  successUrl: string;
  cancelUrl: string;
}

/** 接続アカウント上に Checkout セッションを作成する(direct charge) */
export async function createCheckoutSession(
  env: Env,
  input: CheckoutInput,
): Promise<{ id: string; url: string }> {
  const session = await stripeRequest<{ id: string; url: string }>(
    env,
    'POST',
    '/v1/checkout/sessions',
    {
      mode: 'payment',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.paymentId,
      metadata: { payment_id: input.paymentId },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amount,
            product_data: { name: input.productName },
          },
        },
      ],
    },
    { stripeAccount: input.stripeAccount },
  );
  return { id: session.id, url: session.url };
}

/** 定数時間比較(署名検証用) */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Stripe webhook 署名(Stripe-Signature ヘッダ)を検証する。
 * ヘッダ形式: t=timestamp,v1=signature[,v1=...]
 * 署名対象は `${t}.${rawBody}`。tolerance(秒)で時刻ずれを制限する。
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): Promise<boolean> {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const [k, ...rest] = kv.split('=');
      return [k!.trim(), rest.join('=')];
    }),
  );
  const t = Number.parseInt(parts.t ?? '', 10);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  // v1 は複数ありうる(署名ローテーション)。いずれか一致で可
  const provided = signatureHeader
    .split(',')
    .filter((kv) => kv.trim().startsWith('v1='))
    .map((kv) => kv.trim().slice(3));
  return provided.some((sig) => timingSafeEqual(sig, expected));
}
