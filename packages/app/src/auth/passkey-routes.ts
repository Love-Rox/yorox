/**
 * パスキー(WebAuthn)ログイン(実装順序: docs/OPEN-QUESTIONS.md #5 の第2弾)。
 * 検証は @simplewebauthn/server(WebCrypto ベース、Workers 対応)。
 *
 * チャレンジは httpOnly cookie に持たせて request pair 間で照合する。
 * ログインは discoverable credential(パスキー本来の UX)のみを想定し、
 * ユーザー名の事前入力は不要。
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { getCookie } from 'hono/cookie';
import { createSession, sessionCookieHeader } from './session';
import { createDb, schema } from '../db/client';
import { ulid } from '../lib/ulid';
import { getSessionActorId } from '../server/route-auth';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

const CHALLENGE_COOKIE = 'yorox_webauthn_challenge';
const RP_NAME = 'Yorox';

function isSecure(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

function assertSameOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  return origin === new URL(c.req.url).origin;
}

function challengeCookieHeader(c: Context, value: string, maxAge = 300): string {
  return `${CHALLENGE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${isSecure(c) ? '; Secure' : ''}`;
}

/** rpID はホスト名(ポートなし) */
function rpId(c: Context): string {
  return new URL(c.req.url).hostname;
}

const passkey = new Hono();

/** 登録オプション(ログイン済み) */
passkey.post('/auth/passkey/register/options', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.json({ error: 'login required' }, 401);
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, actorId),
  });
  const existing = await db.query.passkeys.findMany({
    where: eq(schema.passkeys.userActorId, actorId),
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(c),
    userName: actor?.handle ?? actorId,
    userDisplayName: actor?.displayName ?? '',
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credentialId })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });
  c.header('set-cookie', challengeCookieHeader(c, options.challenge));
  return c.json(options);
});

/** 登録の検証と保存 */
passkey.post('/auth/passkey/register/verify', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.json({ error: 'login required' }, 401);

  const expectedChallenge = getCookie(c, CHALLENGE_COOKIE);
  c.header('set-cookie', challengeCookieHeader(c, '', 0));
  if (!expectedChallenge) return c.json({ error: 'challenge expired' }, 400);

  const body = (await c.req.json()) as RegistrationResponseJSON & { label?: string };
  try {
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: new URL(c.req.url).origin,
      expectedRPID: rpId(c),
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: 'verification failed' }, 400);
    }
    const { credential } = verification.registrationInfo;
    await db.insert(schema.passkeys).values({
      id: ulid(),
      userActorId: actorId,
      credentialId: credential.id,
      publicKey: btoa(String.fromCharCode(...credential.publicKey))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', ''),
      counter: credential.counter,
      transports: body.response.transports ?? null,
      label: typeof body.label === 'string' ? body.label.slice(0, 100) : null,
      createdAt: new Date(),
    });
    return c.json({ ok: true });
  } catch (err) {
    console.warn('[passkey] registration failed:', err);
    return c.json({ error: 'verification failed' }, 400);
  }
});

/** ログインオプション(匿名。discoverable credential 前提) */
passkey.post('/auth/passkey/login/options', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const options = await generateAuthenticationOptions({
    rpID: rpId(c),
    userVerification: 'preferred',
    allowCredentials: [],
  });
  c.header('set-cookie', challengeCookieHeader(c, options.challenge));
  return c.json(options);
});

/** ログインの検証とセッション発行 */
passkey.post('/auth/passkey/login/verify', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);

  const expectedChallenge = getCookie(c, CHALLENGE_COOKIE);
  if (!expectedChallenge) return c.json({ error: 'challenge expired' }, 400);

  const body = (await c.req.json()) as AuthenticationResponseJSON;
  const row = await db.query.passkeys.findFirst({
    where: eq(schema.passkeys.credentialId, body.id),
  });
  if (!row) return c.json({ error: 'unknown credential' }, 400);

  const publicKey = Uint8Array.from(
    atob(row.publicKey.replaceAll('-', '+').replaceAll('_', '/')),
    (ch) => ch.charCodeAt(0),
  );
  try {
    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: new URL(c.req.url).origin,
      expectedRPID: rpId(c),
      requireUserVerification: false,
      credential: {
        id: row.credentialId,
        publicKey,
        counter: row.counter,
        transports: (row.transports ?? undefined) as never,
      },
    });
    if (!verification.verified) return c.json({ error: 'verification failed' }, 400);

    await db
      .update(schema.passkeys)
      .set({
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      })
      .where(eq(schema.passkeys.id, row.id));

    const { token, expiresAt } = await createSession(db, row.userActorId);
    c.header('set-cookie', challengeCookieHeader(c, '', 0));
    c.header('set-cookie', sessionCookieHeader(token, expiresAt, isSecure(c)), {
      append: true,
    });
    return c.json({ ok: true });
  } catch (err) {
    console.warn('[passkey] authentication failed:', err);
    return c.json({ error: 'verification failed' }, 400);
  }
});

/** パスキーのリネーム(設定画面) */
passkey.post('/auth/passkey/:id/rename', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const form = await c.req.parseBody();
  const raw = typeof form.label === 'string' ? form.label : '';
  const label = raw.replace(/\p{Cc}/gu, '').trim().slice(0, 100) || null;
  await db
    .update(schema.passkeys)
    .set({ label })
    .where(
      and(eq(schema.passkeys.id, c.req.param('id')), eq(schema.passkeys.userActorId, actorId)),
    );
  return c.redirect('/settings/profile#oauth', 302);
});

/** パスキーの削除(設定画面) */
passkey.post('/auth/passkey/:id/delete', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  await db
    .delete(schema.passkeys)
    .where(
      and(eq(schema.passkeys.id, c.req.param('id')), eq(schema.passkeys.userActorId, actorId)),
    );
  return c.redirect('/settings/profile#oauth', 302);
});

export default function passkeyRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', passkey);
  return (_c, next) => next();
}
