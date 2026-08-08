/**
 * アクティビティの署名付き配信(server-to-server)。
 * 送信元アクターの秘密鍵で HTTP Signatures を付けて inbox へ POST する。
 */
import { AP_MEDIA_TYPE, signRequest, type ApActivity } from '@yorox/ap';

export interface DeliverInput {
  activity: ApActivity;
  inboxUrl: string;
  /** 送信元アクターの URI(keyId は `${actorUri}#main-key`) */
  actorUri: string;
  privateKeyPem: string;
}

/** 1 つの inbox へ配信する。2xx なら true */
export async function deliverActivity(input: DeliverInput): Promise<boolean> {
  const body = JSON.stringify(input.activity);
  const signed = await signRequest({
    method: 'POST',
    url: input.inboxUrl,
    body,
    keyId: `${input.actorUri}#main-key`,
    privateKeyPem: input.privateKeyPem,
  });
  try {
    const res = await fetch(input.inboxUrl, {
      method: 'POST',
      headers: {
        'content-type': AP_MEDIA_TYPE,
        accept: AP_MEDIA_TYPE,
        'user-agent': `Yorox/${__YOROX_VERSION__} (+https://github.com/Love-Rox/yorox)`,
        date: signed.date!,
        digest: signed.digest!,
        signature: signed.signature!,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    // 応答本文は読み捨てる(コネクション解放)
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}
