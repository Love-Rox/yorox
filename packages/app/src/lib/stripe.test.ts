import { describe, expect, it } from 'vitest';
import { encodeStripeForm, verifyStripeSignature } from './stripe';

/** テスト用: Stripe と同じ手順で署名ヘッダを作る(HMAC-SHA256 over `${t}.${body}`) */
async function signPayload(secret: string, body: string, t: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

describe('encodeStripeForm', () => {
  it('ネストしたオブジェクト・配列を Stripe 形式にする', () => {
    const encoded = encodeStripeForm({
      mode: 'payment',
      metadata: { payment_id: '01ABC' },
      line_items: [{ quantity: 1, price_data: { unit_amount: 500 } }],
    });
    expect(encoded).toContain('mode=payment');
    expect(encoded).toContain('metadata%5Bpayment_id%5D=01ABC');
    expect(encoded).toContain('line_items%5B0%5D%5Bquantity%5D=1');
    expect(encoded).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=500');
  });

  it('undefined / null は除外する', () => {
    expect(encodeStripeForm({ a: 1, b: undefined, c: null })).toBe('a=1');
  });
});

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret';
  const body = '{"type":"checkout.session.completed","data":{"object":{}}}';

  it('正しい署名を検証する', async () => {
    const now = 1_700_000_000;
    const header = await signPayload(secret, body, now);
    expect(await verifyStripeSignature(body, header, secret, now)).toBe(true);
  });

  it('ボディ改竄で失敗する', async () => {
    const now = 1_700_000_000;
    const header = await signPayload(secret, body, now);
    expect(await verifyStripeSignature('{"tampered":true}', header, secret, now)).toBe(false);
  });

  it('別のシークレットで失敗する', async () => {
    const now = 1_700_000_000;
    const header = await signPayload(secret, body, now);
    expect(await verifyStripeSignature(body, header, 'whsec_other', now)).toBe(false);
  });

  it('許容時刻を超えたタイムスタンプで失敗する(リプレイ防止)', async () => {
    const t = 1_700_000_000;
    const header = await signPayload(secret, body, t);
    // 10分後に受信 → tolerance(300s)超過
    expect(await verifyStripeSignature(body, header, secret, t + 600)).toBe(false);
  });
});
