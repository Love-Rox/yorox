/**
 * インスタンスアクター(Application)。
 * signed fetch(Threads や Mastodon の認証フェッチモードが要求する
 * 署名付き GET)の署名主体として使う。文書は /actor で公開される。
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from './ulid';
import { ensureActorKeys } from './actor-keys';

/** インスタンスアクター行を返す(なければ作成)。署名用の鍵も保証する */
export async function getInstanceActorSigner(
  db: Db,
  origin: string,
): Promise<{ keyId: string; privateKeyPem: string }> {
  const uri = `${origin}/actor`;
  let actor = await db.query.actors.findFirst({
    where: eq(schema.actors.uri, uri),
  });
  if (!actor) {
    const now = new Date();
    const row = {
      id: ulid(),
      kind: 'user' as const,
      state: 'local' as const,
      handle: null,
      domain: null,
      uri,
      displayName: 'Yorox',
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(schema.actors).values(row).onConflictDoNothing();
    actor = await db.query.actors.findFirst({ where: eq(schema.actors.uri, uri) });
    if (!actor) throw new Error('failed to create instance actor');
  }
  const keys = await ensureActorKeys(db, actor.id);
  return { keyId: `${uri}#main-key`, privateKeyPem: keys.privateKeyPem };
}

/** インスタンスアクター文書(/actor で返す) */
export async function buildInstanceActorDoc(db: Db, origin: string) {
  const uri = `${origin}/actor`;
  await getInstanceActorSigner(db, origin); // 行と鍵を保証
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.uri, uri),
  });
  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
    id: uri,
    type: 'Application',
    preferredUsername: new URL(origin).hostname,
    name: 'Yorox',
    inbox: `${origin}/inbox`,
    outbox: `${origin}/actor/outbox`,
    publicKey: {
      id: `${uri}#main-key`,
      owner: uri,
      publicKeyPem: actor?.publicKeyPem ?? '',
    },
  };
}
