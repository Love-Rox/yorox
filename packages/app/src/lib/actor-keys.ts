/**
 * AP アクターの RSA 鍵ペア(HTTP Signatures 用)。
 * アクター文書の初回参照時に遅延生成して DB に保存する。
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';

function toPem(buffer: ArrayBuffer, label: string): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const lines = b64.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

export interface ActorKeys {
  publicKeyPem: string;
  privateKeyPem: string;
}

/** アクターの鍵ペア PEM を返す(未生成なら RSA 2048 を生成して保存) */
export async function ensureActorKeys(db: Db, actorId: string): Promise<ActorKeys> {
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, actorId),
  });
  if (!actor) throw new Error(`actor not found: ${actorId}`);
  if (actor.publicKeyPem && actor.privateKeyPem) {
    return { publicKeyPem: actor.publicKeyPem, privateKeyPem: actor.privateKeyPem };
  }

  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const publicKeyPem = toPem(
    await crypto.subtle.exportKey('spki', pair.publicKey),
    'PUBLIC KEY',
  );
  const privateKeyPem = toPem(
    await crypto.subtle.exportKey('pkcs8', pair.privateKey),
    'PRIVATE KEY',
  );

  await db
    .update(schema.actors)
    .set({ publicKeyPem, privateKeyPem })
    .where(eq(schema.actors.id, actorId));
  return { publicKeyPem, privateKeyPem };
}
