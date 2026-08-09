/**
 * Stripe Connect の HTTP エンドポイント。
 * - グループの Stripe 接続(OAuth)/ 解除
 * - Checkout セッション作成 → リダイレクト(支払いへ進む)
 * - webhook 受信(署名検証 → markPayment)
 *
 * すべて STRIPE_* env が設定されている場合のみ機能する。
 */
import { and, eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { getCookie } from 'hono/cookie';
import { createDb, schema } from '../db/client';
import { markPayment } from '../domain/payment';
import { generateToken } from '../lib/token';
import {
  connectAuthorizeUrl,
  createCheckoutSession,
  exchangeConnectCode,
  stripeConfigured,
  stripeConnectConfigured,
  verifyStripeSignature,
} from '../lib/stripe';
import { getInstanceActorSigner } from '../lib/instance-actor';
import { assertSameOrigin, isSecureRequest, requestOrigin } from './http';
import { getSessionActorId, hasGroupPermission } from './route-auth';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

const STRIPE_STATE_COOKIE = 'yorox_stripe_state';
const stripe = new Hono();

/** グループの Stripe 接続を開始(OAuth 認可へリダイレクト) */
stripe.get('/g/:handle/settings/stripe/connect', async (c) => {
  const env = await getEnv();
  if (!stripeConnectConfigured(env)) return c.notFound();
  const db = createDb(env.DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const group = await db.query.actors.findFirst({
    where: and(eq(schema.actors.handle, handle), eq(schema.actors.kind, 'group')),
  });
  if (!group || !(await hasGroupPermission(db, group.id, actorId, 'group.settings'))) {
    return c.text('権限がありません', 403);
  }

  const state = `${group.id}.${generateToken()}`;
  c.header(
    'set-cookie',
    `${STRIPE_STATE_COOKIE}=${state}; Max-Age=600; Path=/; HttpOnly; SameSite=Lax${(await isSecureRequest(c)) ? '; Secure' : ''}`,
  );
  const redirectUri = `${await requestOrigin(c)}/auth/stripe/callback`;
  return c.redirect(connectAuthorizeUrl(env, state, redirectUri), 302);
});

/** OAuth コールバック: 接続アカウント ID を保存 */
stripe.get('/auth/stripe/callback', async (c) => {
  const env = await getEnv();
  if (!stripeConnectConfigured(env)) return c.notFound();
  const db = createDb(env.DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const cookieState = getCookie(c, STRIPE_STATE_COOKIE) ?? '';
  c.header('set-cookie', `${STRIPE_STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
  const state = c.req.query('state') ?? '';
  const code = c.req.query('code');
  if (!code || !state || state !== cookieState) {
    return c.text('接続に失敗しました(state 不一致)', 400);
  }
  const groupId = state.split('.')[0]!;
  const group = await db.query.actors.findFirst({ where: eq(schema.actors.id, groupId) });
  if (!group?.handle || !(await hasGroupPermission(db, groupId, actorId, 'group.settings'))) {
    return c.text('権限がありません', 403);
  }

  const result = await exchangeConnectCode(env, code);
  if (!result) return c.text('Stripe との接続に失敗しました', 400);
  await db
    .update(schema.groups)
    .set({ stripeAccountId: result.stripeUserId })
    .where(eq(schema.groups.actorId, groupId));
  return c.redirect(`/g/${group.handle}/settings#stripe`, 302);
});

/** 接続解除 */
stripe.post('/g/:handle/settings/stripe/disconnect', async (c) => {
  if (!(await assertSameOrigin(c))) return c.text('forbidden', 403);
  const env = await getEnv();
  const db = createDb(env.DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const handle = c.req.param('handle');
  const group = await db.query.actors.findFirst({
    where: and(eq(schema.actors.handle, handle), eq(schema.actors.kind, 'group')),
  });
  if (!group || !(await hasGroupPermission(db, group.id, actorId, 'group.settings'))) {
    return c.text('権限がありません', 403);
  }
  await db
    .update(schema.groups)
    .set({ stripeAccountId: null })
    .where(eq(schema.groups.actorId, group.id));
  return c.redirect(`/g/${handle}/settings#stripe`, 302);
});

/** 支払いへ進む: Checkout セッションを作ってリダイレクト */
stripe.post('/payments/:id/checkout', async (c) => {
  if (!(await assertSameOrigin(c))) return c.text('forbidden', 403);
  const env = await getEnv();
  if (!stripeConfigured(env)) return c.notFound();
  const db = createDb(env.DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const payment = await db.query.payments.findFirst({
    where: eq(schema.payments.id, c.req.param('id')),
  });
  if (!payment || payment.method !== 'stripe') return c.notFound();
  if (payment.status !== 'pending') return c.text('この支払いは処理済みです', 409);

  const participation = await db.query.participations.findFirst({
    where: eq(schema.participations.id, payment.participationId),
  });
  // 本人の支払いのみ
  if (!participation || participation.actorId !== actorId) return c.text('権限がありません', 403);
  const slot = await db.query.slots.findFirst({
    where: eq(schema.slots.id, participation.slotId),
  });
  const event = slot
    ? await db.query.events.findFirst({ where: eq(schema.events.id, slot.eventId) })
    : null;
  const group = event
    ? await db.query.actors.findFirst({ where: eq(schema.actors.id, event.groupActorId) })
    : null;
  const groupRow = group
    ? await db.query.groups.findFirst({ where: eq(schema.groups.actorId, group.id) })
    : null;
  if (!slot || !event || !group?.handle || !groupRow?.stripeAccountId) {
    return c.text('この枠は Stripe 決済に対応していません', 400);
  }

  const origin = await requestOrigin(c);
  const eventUrl = `${origin}/g/${group.handle}/events/${event.id}`;
  try {
    const session = await createCheckoutSession(env, {
      stripeAccount: groupRow.stripeAccountId,
      amount: payment.amount,
      currency: payment.currency,
      productName: `${event.title} — ${slot.name}`,
      paymentId: payment.id,
      successUrl: `${eventUrl}?paid=1`,
      cancelUrl: `${eventUrl}?paycancel=1`,
    });
    // セッション id を控えておく(webhook 照合の補助)
    await db
      .update(schema.payments)
      .set({ provider: 'stripe', providerRef: session.id })
      .where(eq(schema.payments.id, payment.id));
    return c.redirect(session.url, 302);
  } catch (err) {
    console.error('[stripe] checkout failed:', err);
    return c.redirect(`${eventUrl}?error=stripe`, 302);
  }
});

/** webhook: 署名検証 → 決済完了/返金を markPayment に反映 */
stripe.post('/webhooks/stripe', async (c) => {
  const env = await getEnv();
  if (!env.STRIPE_WEBHOOK_SECRET) return c.text('not configured', 404);
  const sig = c.req.header('stripe-signature');
  const raw = await c.req.text();
  if (
    !sig ||
    !(await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000)))
  ) {
    return c.text('invalid signature', 400);
  }

  const db = createDb(env.DB);
  let evt: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    evt = JSON.parse(raw);
  } catch {
    return c.text('bad json', 400);
  }
  const obj = evt.data?.object ?? {};

  // システム操作の記録用アクター(インスタンスアクター)
  const systemActorId = await resolveSystemActorId(db, await requestOrigin(c));

  if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
    const paymentId =
      (obj.client_reference_id as string | undefined) ??
      ((obj.metadata as Record<string, string> | undefined)?.payment_id);
    if (paymentId) {
      const payment = await db.query.payments.findFirst({
        where: eq(schema.payments.id, paymentId),
      });
      if (payment && payment.status === 'pending' && systemActorId) {
        await markPayment(db, paymentId, 'paid', systemActorId);
      }
    }
  } else if (evt.type === 'charge.refunded') {
    // providerRef(session id)ではなく payment_intent 経由の返金。
    // ここでは metadata に payment_id があれば返金反映する
    const paymentId = (obj.metadata as Record<string, string> | undefined)?.payment_id;
    if (paymentId && systemActorId) {
      const payment = await db.query.payments.findFirst({
        where: eq(schema.payments.id, paymentId),
      });
      if (payment && payment.status === 'paid') {
        await markPayment(db, paymentId, 'refunded', systemActorId);
      }
    }
  }
  return c.body(null, 200);
});

/** webhook の markPayment 記録に使うインスタンスアクター ID */
async function resolveSystemActorId(
  db: ReturnType<typeof createDb>,
  origin: string,
): Promise<string | null> {
  // インスタンスアクター行を確実に作ってから解決する
  await getInstanceActorSigner(db, origin);
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.uri, `${origin}/actor`),
  });
  return actor?.id ?? null;
}

export default function stripeRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', stripe);
  return (_c: Context, next) => next();
}
