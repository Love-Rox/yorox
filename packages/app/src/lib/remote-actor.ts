/**
 * リモートアクターの取得と actors テーブルへの取り込み。
 *
 * docs/DECISIONS.md「リモートユーザーの初回インタラクション時に
 * エイリアスアカウントを自動生成する」の実装。統一アクターモデルにより
 * リモートもローカルと同じ actors 行(state='remote_unclaimed')になる。
 */
import { eq } from 'drizzle-orm';
import { AP_MEDIA_TYPE, signRequest, type ApActor } from '@yorox/ap';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from './ulid';

const FETCH_TIMEOUT_MS = 10_000;

export interface FetchSigner {
  keyId: string;
  privateKeyPem: string;
}

/**
 * リモートのアクター文書を取得する(失敗時 null)。
 * signer を渡すと署名付き GET(signed fetch)になる。Threads や
 * Mastodon の認証フェッチモードはこれを要求する。
 */
export async function fetchRemoteActor(
  uri: string,
  signer?: FetchSigner,
): Promise<ApActor | null> {
  try {
    const headers: Record<string, string> = {
      accept: `${AP_MEDIA_TYPE}, application/activity+json`,
      'user-agent': `Yorox/${__YOROX_VERSION__} (+https://github.com/Love-Rox/yorox)`,
    };
    if (signer) {
      Object.assign(
        headers,
        await signRequest({
          method: 'GET',
          url: uri,
          keyId: signer.keyId,
          privateKeyPem: signer.privateKeyPem,
        }),
      );
    }
    const res = await fetch(uri, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as ApActor;
    if (!doc.id || !doc.inbox) return null;
    return doc;
  } catch {
    return null;
  }
}


/** アクター文書の Emoji タグ(カスタム絵文字)を shortcode → URL の辞書にする */
function extractEmojis(doc: ApActor): Record<string, string> | null {
  const tags = doc.tag;
  if (!Array.isArray(tags)) return null;
  const emojis: Record<string, string> = {};
  for (const tag of tags as Record<string, unknown>[]) {
    if (tag.type !== 'Emoji' || typeof tag.name !== 'string') continue;
    const icon = tag.icon as { url?: unknown } | undefined;
    if (typeof icon?.url !== 'string') continue;
    emojis[tag.name.replace(/^:|:$/g, '')] = icon.url;
  }
  return Object.keys(emojis).length > 0 ? emojis : null;
}

/**
 * リモートアクター文書を actors に upsert し、行を返す。
 * 既存行があればプロフィール・鍵を更新する(鍵ローテーション追従)。
 */
export async function upsertRemoteActor(db: Db, doc: ApActor) {
  const uri = doc.id!;
  const domain = new URL(uri).hostname;
  const kind = doc.type === 'Group' ? ('group' as const) : ('user' as const);
  const displayName = doc.name || doc.preferredUsername || domain;
  const now = new Date();

  const values = {
    kind,
    handle: doc.preferredUsername ?? null,
    domain,
    inboxUrl: doc.inbox,
    sharedInboxUrl: doc.endpoints?.sharedInbox ?? null,
    displayName,
    summary: typeof doc.summary === 'string' ? doc.summary : null,
    avatarUrl: doc.icon?.url ?? null,
    emojis: extractEmojis(doc),
    publicKeyPem: doc.publicKey?.publicKeyPem ?? null,
    updatedAt: now,
  };

  const existing = await db.query.actors.findFirst({
    where: eq(schema.actors.uri, uri),
  });
  if (existing) {
    // ローカルアクターはリモート文書で上書きしない(自己 URI を keyId に
    // 指定された場合の破壊防止。自己連合テストでもこの分岐を通る)
    if (existing.state === 'local') return existing;
    await db.update(schema.actors).set(values).where(eq(schema.actors.id, existing.id));
    return { ...existing, ...values };
  }

  const row = {
    id: ulid(),
    state: 'remote_unclaimed' as const,
    uri,
    profileLinks: null,
    privateKeyPem: null,
    movedToActorId: null,
    claimedByActorId: null,
    createdAt: now,
    ...values,
  };
  await db.insert(schema.actors).values(row);
  return row;
}

/**
 * keyId(例: https://host/users/x#main-key)からアクターを解決して upsert する。
 * 既知で鍵もあればフェッチせず DB の行を返す(forceRefresh で再取得)。
 */
export async function resolveRemoteActorByKeyId(
  db: Db,
  keyId: string,
  opts: { forceRefresh?: boolean; signer?: FetchSigner } = {},
) {
  const actorUri = keyId.split('#')[0]!;
  const cached = await db.query.actors.findFirst({
    where: eq(schema.actors.uri, actorUri),
  });
  // ローカルアクターは常に DB が正(再フェッチしない)
  if (cached?.state === 'local') return cached;
  if (!opts.forceRefresh && cached?.publicKeyPem) return cached;
  const doc = await fetchRemoteActor(actorUri, opts.signer);
  if (!doc) return null;
  // なりすまし防止: 取得したアクターは、フェッチ先 URL(= keyId のアクター)
  // 自身であり、鍵の id が keyId と一致していなければならない。
  // これを検証しないと、悪意あるサーバーが他人の URI と鍵を主張して
  // その人物として発話できてしまう。
  if (doc.id !== actorUri) return null;
  if (doc.publicKey && doc.publicKey.id !== keyId) return null;
  return upsertRemoteActor(db, doc);
}
