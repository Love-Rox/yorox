/**
 * お問い合わせフォームの送信。
 * CONTACT_EMAIL が設定されているときだけ有効。送信内容はメールキューに積み、
 * cron が設定済みのトランスポート(Cloudflare Email 等)で運営者宛に配信する。
 */
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb } from '../db/client';
import { enqueueMail } from '../mail/queue';
import { assertSameOrigin, formStr } from './http';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

/** Cloudflare Turnstile のトークンを検証する */
async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

const contact = new Hono();

contact.post('/contact', async (c: Context) => {
  const env = await getEnv();
  const to = env.CONTACT_EMAIL;
  if (!to) return c.notFound();
  if (!(await assertSameOrigin(c))) return c.text('forbidden', 403);

  const form = await c.req.parseBody();
  // ハニーポット(ボットが埋めがちな隠しフィールド)。値が入っていたら黙って成功扱い
  if (formStr(form.website)) return c.redirect('/contact?sent=1', 302);

  // Turnstile(設定されているときだけ検証)
  if (env.TURNSTILE_SECRET_KEY) {
    const ok = await verifyTurnstile(
      env.TURNSTILE_SECRET_KEY,
      formStr(form['cf-turnstile-response']),
      c.req.header('cf-connecting-ip'),
    );
    if (!ok) return c.redirect('/contact?error=turnstile', 302);
  }

  const email = formStr(form.email).slice(0, 200);
  const name = formStr(form.name).slice(0, 100);
  const message = formStr(form.message).slice(0, 4000);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || message.trim().length < 5) {
    return c.redirect('/contact?error=invalid', 302);
  }

  const db = createDb(env.DB);
  const bodyText = [
    'お問い合わせフォームからの送信です。',
    '',
    `名前: ${name || '(未記入)'}`,
    `返信先: ${email}`,
    '',
    '--- 本文 ---',
    message,
  ].join('\n');

  await enqueueMail(db, {
    to,
    subject: `[お問い合わせ] ${name || email}`,
    bodyText,
  });

  return c.redirect('/contact?sent=1', 302);
});

export default function contactRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', contact);
  return (_c, next) => next();
}
