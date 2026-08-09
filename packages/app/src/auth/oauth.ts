/**
 * OAuth ログイン(実装順序: docs/OPEN-QUESTIONS.md #5 の第3弾)。
 * 標準の Authorization Code フローをゼロ依存で実装する。
 *
 * プロバイダの追加は PROVIDERS にエントリを足し、Env に
 * {NAME}_CLIENT_ID / {NAME}_CLIENT_SECRET を追加するだけでよい。
 */

export type OAuthProviderId = 'github' | 'google';

export interface OAuthIdentity {
  providerUserId: string;
  /** 表示用(設定画面の連携一覧に出す) */
  label: string;
  /** プロバイダが検証済みのメールアドレス(未取得なら null) */
  email: string | null;
  displayName?: string | undefined;
}

interface OAuthProviderDef {
  id: OAuthProviderId;
  name: string;
  authorizeUrl: (clientId: string, redirectUri: string, state: string) => string;
  fetchIdentity: (
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string,
  ) => Promise<OAuthIdentity | null>;
}

// AbortSignal.timeout はグローバルスコープで呼べない(workerd)ため関数にする
const timeout = () => ({ signal: AbortSignal.timeout(10_000) });

/** GitHub: https://docs.github.com/apps/oauth-apps */
const github: OAuthProviderDef = {
  id: 'github',
  name: 'GitHub',
  authorizeUrl: (clientId, redirectUri, state) =>
    `https://github.com/login/oauth/authorize?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: 'read:user user:email',
    })}`,
  async fetchIdentity(clientId, clientSecret, code, redirectUri) {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      ...timeout(),
    });
    if (!tokenRes.ok) return null;
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) return null;

    const ghHeaders = {
      authorization: `Bearer ${access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': `Yorox/${__YOROX_VERSION__}`,
    };
    const userRes = await fetch('https://api.github.com/user', {
      headers: ghHeaders,
      ...timeout(),
    });
    if (!userRes.ok) return null;
    const user = (await userRes.json()) as { id: number; login: string; name?: string };

    // 検証済みプライマリメール(email スコープ)
    let email: string | null = null;
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: ghHeaders,
      ...timeout(),
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as {
        email: string;
        primary: boolean;
        verified: boolean;
      }[];
      email =
        emails.find((e) => e.primary && e.verified)?.email ??
        emails.find((e) => e.verified)?.email ??
        null;
    }
    return {
      providerUserId: String(user.id),
      label: `@${user.login}`,
      email: email?.toLowerCase() ?? null,
      displayName: user.name ?? user.login,
    };
  },
};

/** Google: OIDC(id_token は TLS 経由でトークンエンドポイントから直接受けるため署名検証不要) */
const google: OAuthProviderDef = {
  id: 'google',
  name: 'Google',
  authorizeUrl: (clientId, redirectUri, state) =>
    `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: 'openid email profile',
    })}`,
  async fetchIdentity(clientId, clientSecret, code, redirectUri) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      ...timeout(),
    });
    if (!tokenRes.ok) return null;
    const { id_token } = (await tokenRes.json()) as { id_token?: string };
    if (!id_token) return null;

    const payloadPart = id_token.split('.')[1];
    if (!payloadPart) return null;
    const payload = JSON.parse(
      atob(payloadPart.replaceAll('-', '+').replaceAll('_', '/')),
    ) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
    if (!payload.sub) return null;
    return {
      providerUserId: payload.sub,
      label: payload.email ?? payload.sub,
      email: payload.email_verified && payload.email ? payload.email.toLowerCase() : null,
      displayName: payload.name,
    };
  },
};

const PROVIDERS: Record<OAuthProviderId, OAuthProviderDef> = { github, google };

export function getProvider(id: string): OAuthProviderDef | null {
  return id === 'github' || id === 'google' ? PROVIDERS[id] : null;
}

/** プロバイダの認証情報(未設定なら null = そのプロバイダは無効) */
export function providerCredentials(
  env: Env,
  id: OAuthProviderId,
): { clientId: string; clientSecret: string } | null {
  const clientId = id === 'github' ? env.GITHUB_CLIENT_ID : env.GOOGLE_CLIENT_ID;
  const clientSecret = id === 'github' ? env.GITHUB_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** 環境で有効になっているプロバイダの一覧 */
export function enabledProviders(env: Env): { id: OAuthProviderId; name: string }[] {
  return (Object.values(PROVIDERS) as OAuthProviderDef[])
    .filter((p) => providerCredentials(env, p.id) !== null)
    .map((p) => ({ id: p.id, name: p.name }));
}
