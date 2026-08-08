/**
 * 認証エンドポイント(Hono ルート)。
 * ap-routes.ts と同様に middlewareFn としてアプリへマウントする。
 *
 * CSRF: セッション cookie は SameSite=Lax なのでクロスサイト POST には乗らない。
 * 加えて POST 系は Origin ヘッダの同一性を検証する。
 */
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { getCookie } from 'hono/cookie';
import { consumeLoginToken, issueSignupTicket, requestMagicLink } from '../auth/magic-link';
import {
  clearSessionCookieHeader,
  createSession,
  destroySession,
  SESSION_COOKIE,
  sessionCookieHeader,
} from '../auth/session';
import { createDb, schema } from '../db/client';
import { HandleTakenError, validateHandle } from '../domain/groups';
import { createUser, EmailTakenError, isHandleAvailable } from '../domain/users';
import { createDirectSender } from '../mail/send';
import { eq } from 'drizzle-orm';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

function isSecure(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

/** POST の Origin 検証(同一オリジンのフォーム送信のみ受け付ける) */
function assertSameOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true; // 同一オリジンのフォーム POST でも省略されるUAがあるため許容
  return origin === new URL(c.req.url).origin;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const auth = new Hono();

auth.post('/auth/magic-link/request', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const form = await c.req.parseBody();
  const email = typeof form.email === 'string' ? form.email.trim().toLowerCase() : '';
  if (!EMAIL_PATTERN.test(email)) {
    return c.redirect('/login?error=invalid_email', 302);
  }
  const env = await getEnv();
  const db = createDb(env.DB);
  // メールの存在有無を露出しないため、結果に関わらず同じ画面へ
  await requestMagicLink(db, createDirectSender(env), {
    email,
    origin: new URL(c.req.url).origin,
  });
  return c.redirect('/login/sent', 302);
});

auth.get('/auth/magic-link/verify', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.redirect('/login?error=invalid_token', 302);

  const env = await getEnv();
  const db = createDb(env.DB);
  const email = await consumeLoginToken(db, token);
  if (!email) return c.redirect('/login?error=expired', 302);

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  if (existing) {
    const { token: sessionToken, expiresAt } = await createSession(db, existing.actorId);
    c.header('set-cookie', sessionCookieHeader(sessionToken, expiresAt, isSecure(c)));
    return c.redirect('/', 302);
  }

  // 新規: メール検証済みチケットを発行してオンボーディングへ
  const ticket = await issueSignupTicket(db, email);
  return c.redirect(`/onboarding?ticket=${ticket}`, 302);
});

auth.post('/auth/signup', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const form = await c.req.parseBody();
  const ticket = typeof form.ticket === 'string' ? form.ticket : '';
  const handle = typeof form.handle === 'string' ? form.handle.trim().toLowerCase() : '';
  const displayName =
    typeof form.display_name === 'string' ? form.display_name.trim() : '';

  const env = await getEnv();
  const db = createDb(env.DB);

  if (!validateHandle(handle) || !displayName) {
    return c.redirect(`/onboarding?ticket=${ticket}&error=invalid_input`, 302);
  }
  if (!(await isHandleAvailable(db, handle))) {
    return c.redirect(`/onboarding?ticket=${ticket}&error=handle_taken`, 302);
  }

  // チケット(メール検証済みトークン)をここで消費する
  const email = await consumeLoginToken(db, ticket);
  if (!email) return c.redirect('/login?error=expired', 302);

  try {
    const { userActorId } = await createUser(db, {
      email,
      handle,
      displayName,
      origin: new URL(c.req.url).origin,
    });
    const { token: sessionToken, expiresAt } = await createSession(db, userActorId);
    c.header('set-cookie', sessionCookieHeader(sessionToken, expiresAt, isSecure(c)));
    return c.redirect('/', 302);
  } catch (err) {
    if (err instanceof HandleTakenError || err instanceof EmailTakenError) {
      return c.redirect('/login?error=conflict', 302);
    }
    throw err;
  }
});

auth.post('/auth/logout', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const env = await getEnv();
  const db = createDb(env.DB);
  await destroySession(db, getCookie(c, SESSION_COOKIE));
  c.header('set-cookie', clearSessionCookieHeader(isSecure(c)));
  return c.redirect('/', 302);
});

export default function authRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', auth);
  return (_c, next) => next();
}
