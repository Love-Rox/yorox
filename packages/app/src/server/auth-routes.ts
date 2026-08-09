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
import {
  consumeLoginToken,
  consumeLoginTokenDetailed,
  issueSignupTicket,
  requestMagicLink,
} from '../auth/magic-link';
import { getProvider, providerCredentials, type OAuthProviderId } from '../auth/oauth';
import { generateToken } from '../lib/token';
import { ulid } from '../lib/ulid';
import { getSessionActorId } from './route-auth';
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
import { and, eq } from 'drizzle-orm';
import { assertSameOrigin, isSecureRequest, requestOrigin } from './http';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ログイン確認の中間ページ(GET でトークンを消費しないための緩衝) */
function confirmLoginPage(token: string): string {
  const safe = token.replace(/[^A-Za-z0-9_-]/g, '');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ログイン - Yorox</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4efde;color:#1b2240;font-family:system-ui,sans-serif;padding:2rem}
@media(prefers-color-scheme:dark){body{background:#12162b;color:#efe9d6}}
.card{text-align:center;max-width:22rem}button{margin-top:1rem;padding:.7rem 2rem;font-weight:700;font-size:1rem;cursor:pointer;background:#1b2240;color:#f4efde;border:none}
p{font-size:.9rem;opacity:.75}</style></head>
<body><form class="card" method="post" action="/auth/magic-link/confirm">
<input type="hidden" name="token" value="${safe}">
<h1>Yorox にログイン</h1>
<p>下のボタンを押すとログインが完了します。</p>
<button type="submit">ログインする</button>
</form></body></html>`;
}

const auth = new Hono();

auth.post('/auth/magic-link/request', async (c) => {
  if (!(await assertSameOrigin(c))) return c.text('forbidden', 403);
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
    origin: await requestOrigin(c),
  });
  return c.redirect('/login/sent', 302);
});

// GET はトークンを消費せず確認ページを返す。メールのリンクプリフェッチ/
// スキャナが単回トークンを先に潰すことと、SameSite=Lax の GET による
// ログイン CSRF を防ぐ(実際の消費は Origin 検証付き POST で行う)。
auth.get('/auth/magic-link/verify', (c) => {
  const token = c.req.query('token');
  if (!token) return c.redirect('/login?error=invalid_token', 302);
  return c.html(confirmLoginPage(token));
});

auth.post('/auth/magic-link/confirm', async (c) => {
  if (!(await assertSameOrigin(c))) return c.text('forbidden', 403);
  const form = await c.req.parseBody();
  const token = typeof form.token === 'string' ? form.token : '';
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
    c.header('set-cookie', sessionCookieHeader(sessionToken, expiresAt, await isSecureRequest(c)));
    return c.redirect('/', 302);
  }

  // 新規: メール検証済みチケットを発行してオンボーディングへ
  const ticket = await issueSignupTicket(db, email);
  return c.redirect(`/onboarding?ticket=${ticket}`, 302);
});

auth.post('/auth/signup', async (c) => {
  if (!(await assertSameOrigin(c))) return c.text('forbidden', 403);
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
  const consumed = await consumeLoginTokenDetailed(db, ticket);
  if (!consumed) return c.redirect('/login?error=expired', 302);
  const { email, oauthPayload } = consumed;

  try {
    const { userActorId } = await createUser(db, {
      email,
      handle,
      displayName,
      origin: await requestOrigin(c),
    });
    // OAuth 経由のサインアップなら、そのプロバイダを自動で連携する
    if (oauthPayload) {
      await linkOAuthAccount(
        db,
        oauthPayload.provider as OAuthProviderId,
        oauthPayload.providerUserId,
        oauthPayload.label,
        userActorId,
      );
    }
    const { token: sessionToken, expiresAt } = await createSession(db, userActorId);
    c.header('set-cookie', sessionCookieHeader(sessionToken, expiresAt, await isSecureRequest(c)));
    return c.redirect('/', 302);
  } catch (err) {
    if (err instanceof HandleTakenError || err instanceof EmailTakenError) {
      return c.redirect('/login?error=conflict', 302);
    }
    throw err;
  }
});


// ---------------------------------------------------------------------------
// OAuth(Authorization Code フロー)
// ---------------------------------------------------------------------------

const OAUTH_STATE_COOKIE = 'yorox_oauth_state';

async function oauthRedirectUri(c: Context, provider: string): Promise<string> {
  return `${await requestOrigin(c)}/auth/oauth/${provider}/callback`;
}

/** OAuth アカウントをユーザーに紐付ける。他ユーザーに紐付いていれば false */
async function linkOAuthAccount(
  db: ReturnType<typeof createDb>,
  provider: OAuthProviderId,
  providerUserId: string,
  label: string,
  userActorId: string,
): Promise<boolean> {
  const existing = await db.query.oauthAccounts.findFirst({
    where: (t, { and: a, eq: e }) => a(e(t.provider, provider), e(t.providerUserId, providerUserId)),
  });
  if (existing) return existing.userActorId === userActorId;
  await db.insert(schema.oauthAccounts).values({
    id: ulid(),
    provider,
    providerUserId,
    userActorId,
    label,
    createdAt: new Date(),
  });
  return true;
}

/**
 * OAuth 開始。?link=1 なら「ログイン済みユーザーへの追加連携」モード。
 * state はワンタイム値を cookie に持たせて callback で照合する。
 */
auth.get('/auth/oauth/:provider/start', async (c) => {
  const providerId = c.req.param('provider');
  const provider = getProvider(providerId);
  const env = await getEnv();
  const creds = provider && providerCredentials(env, provider.id);
  if (!provider || !creds) return c.notFound();

  const mode = c.req.query('link') === '1' ? 'link' : 'login';
  const state = generateToken();
  c.header(
    'set-cookie',
    `${OAUTH_STATE_COOKIE}=${state}.${mode}; Max-Age=600; Path=/; HttpOnly; SameSite=Lax${await isSecureRequest(c) ? '; Secure' : ''}`,
  );
  return c.redirect(
    provider.authorizeUrl(creds.clientId, await oauthRedirectUri(c, provider.id), state),
    302,
  );
});

auth.get('/auth/oauth/:provider/callback', async (c) => {
  const providerId = c.req.param('provider');
  const provider = getProvider(providerId);
  const env = await getEnv();
  const creds = provider && providerCredentials(env, provider.id);
  if (!provider || !creds) return c.notFound();

  // state 検証(CSRF 対策)
  const stateCookie = getCookie(c, OAUTH_STATE_COOKIE) ?? '';
  const [cookieState, mode] = stateCookie.split('.');
  c.header(
    'set-cookie',
    `${OAUTH_STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${await isSecureRequest(c) ? '; Secure' : ''}`,
  );
  const state = c.req.query('state');
  const code = c.req.query('code');
  if (!code || !state || !cookieState || state !== cookieState) {
    return c.redirect('/login?error=oauth_state', 302);
  }

  const identity = await provider.fetchIdentity(
    creds.clientId,
    creds.clientSecret,
    code,
    await oauthRedirectUri(c, provider.id),
  );
  if (!identity) return c.redirect('/login?error=oauth_failed', 302);

  const db = createDb(env.DB);

  // 追加連携モード: ログイン済みユーザーに紐付ける
  if (mode === 'link') {
    const actorId = await getSessionActorId(db, c);
    if (!actorId) return c.redirect('/login', 302);
    const ok = await linkOAuthAccount(
      db,
      provider.id,
      identity.providerUserId,
      identity.label,
      actorId,
    );
    return c.redirect(
      ok
        ? '/settings/profile?oauth_ok=1#oauth'
        : `/settings/profile?oauth_error=${encodeURIComponent('この' + provider.name + ' アカウントは別のユーザーに連携済みです')}#oauth`,
      302,
    );
  }

  // ログインモード: 連携済みならログイン
  const linked = await db.query.oauthAccounts.findFirst({
    where: (t, { and: a, eq: e }) =>
      a(e(t.provider, provider.id), e(t.providerUserId, identity.providerUserId)),
  });
  if (linked) {
    const { token: sessionToken, expiresAt } = await createSession(db, linked.userActorId);
    c.header('set-cookie', sessionCookieHeader(sessionToken, expiresAt, await isSecureRequest(c)));
    return c.redirect('/', 302);
  }

  // 未連携: 検証済みメールが既存ユーザーと一致すれば自動リンクしてログイン
  if (identity.email) {
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.email, identity.email),
    });
    if (existing) {
      const linked = await linkOAuthAccount(
        db,
        provider.id,
        identity.providerUserId,
        identity.label,
        existing.actorId,
      );
      if (!linked) console.warn('[oauth] identity already linked to another user', provider.id);
      const { token: sessionToken, expiresAt } = await createSession(db, existing.actorId);
      c.header('set-cookie', sessionCookieHeader(sessionToken, expiresAt, await isSecureRequest(c)));
      return c.redirect('/', 302);
    }
    // 新規: メール検証済みチケット(OAuth ペイロード付き)でオンボーディングへ
    const ticket = await issueSignupTicket(db, identity.email, new Date(), {
      provider: provider.id,
      providerUserId: identity.providerUserId,
      label: identity.label,
    });
    return c.redirect(`/onboarding?ticket=${ticket}`, 302);
  }

  return c.redirect('/login?error=oauth_no_email', 302);
});

/** OAuth 連携の解除(メールログインは常に残るため安全) */
auth.post('/auth/oauth/:id/unlink', async (c) => {
  if (!(await assertSameOrigin(c))) return c.text('forbidden', 403);
  const env = await getEnv();
  const db = createDb(env.DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  await db
    .delete(schema.oauthAccounts)
    .where(
      // 自分の連携のみ削除できる
      and(
        eq(schema.oauthAccounts.id, c.req.param('id')),
        eq(schema.oauthAccounts.userActorId, actorId),
      ),
    );
  return c.redirect('/settings/profile#oauth', 302);
});

auth.post('/auth/logout', async (c) => {
  if (!(await assertSameOrigin(c))) return c.text('forbidden', 403);
  const env = await getEnv();
  const db = createDb(env.DB);
  await destroySession(db, getCookie(c, SESSION_COOKIE));
  c.header('set-cookie', clearSessionCookieHeader(await isSecureRequest(c)));
  return c.redirect('/', 302);
});

export default function authRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', auth);
  return (_c, next) => next();
}
