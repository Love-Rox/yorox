'use client';
/**
 * パスキー(WebAuthn)のブラウザ側セレモニー。
 * サーバーの options/verify エンドポイントと @simplewebauthn/browser を繋ぐ。
 */
import { useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

async function postJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** ログイン画面用: パスキーでログイン */
export function PasskeyLoginButton() {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const login = async () => {
    setState('busy');
    try {
      const options = await postJson<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/auth/passkey/login/options');
      const assertion = await startAuthentication({ optionsJSON: options });
      await postJson('/auth/passkey/login/verify', assertion);
      location.href = '/';
    } catch (err) {
      console.warn('passkey login failed:', err);
      setState('error');
    }
  };
  return (
    <div>
      <button
        type="button"
        onClick={login}
        disabled={state === 'busy'}
        className="btn w-full cursor-pointer disabled:opacity-50"
      >
        {state === 'busy' ? '確認中…' : 'パスキーでログイン'}
      </button>
      {state === 'error' && (
        <p role="alert" className="mt-2 text-sm text-accent">
          パスキーでのログインに失敗しました。メールでログインしてから、設定画面で
          パスキーを登録し直せます。
        </p>
      )}
    </div>
  );
}

/** 設定画面用: このデバイスでパスキーを登録 */
export function PasskeyRegisterButton() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const register = async () => {
    setState('busy');
    try {
      const options = await postJson<Parameters<typeof startRegistration>[0]['optionsJSON']>('/auth/passkey/register/options');
      const attestation = await startRegistration({ optionsJSON: options });
      // 表示用ラベルとして OS / ブラウザのおおまかな情報を添える
      const label = navigator.platform || navigator.userAgent.slice(0, 60);
      await postJson('/auth/passkey/register/verify', { ...attestation, label });
      setState('done');
      location.reload();
    } catch (err) {
      console.warn('passkey registration failed:', err);
      setState('error');
    }
  };
  return (
    <div>
      <button
        type="button"
        onClick={register}
        disabled={state === 'busy'}
        className="btn-quiet cursor-pointer disabled:opacity-50"
      >
        {state === 'busy' ? '確認中…' : 'このデバイスでパスキーを登録'}
      </button>
      {state === 'error' && (
        <p role="alert" className="mt-2 text-sm text-accent">
          登録に失敗しました。ブラウザがパスキーに対応しているかご確認ください。
        </p>
      )}
    </div>
  );
}
