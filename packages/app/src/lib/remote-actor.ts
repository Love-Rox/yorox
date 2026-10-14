/**
 * リモートアクターの取得と actors テーブルへの取り込み。
 *
 * docs/DECISIONS.md「リモートユーザーの初回インタラクション時に
 * エイリアスアカウントを自動生成する」の実装。統一アクターモデルにより
 * リモートもローカルと同じ actors 行(state='remote_unclaimed')になる。
 */
import { eq } from 'drizzle-orm';
import { AP_MEDIA_TYPE, signRequest, type ApActor, type ApPublicKey } from '@yorox/ap';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from './ulid';
import { isPublicHttpUrl } from './safe-fetch';

const FETCH_TIMEOUT_MS = 10_000;

export interface FetchSigner {
  keyId: string;
  privateKeyPem: string;
}

/**
 * リモートのアクター文書を取得する(失敗時 null)。
 * signer を渡すと署名付き GET(signed fetch)になる。Threads や
 * Mastodon の認証フェッチモードはこれを要求する。
 *
 * 返す文書は必ず「自分の id から取得したもの」に限る(なりすまし防止)。
 * 取得先と doc.id が異なる(プロフィール URL を渡された等)場合は doc.id を
 * 取り直し、そこで同じ id が返ったときだけ採用する。これを怠ると、悪意ある
 * サーバーが他人の id と自分の鍵を主張する文書で既存行を上書きできてしまう。
 */
export async function fetchRemoteActor(
  uri: string,
  signer?: FetchSigner,
  preferredKeyId?: string,
): Promise<ApActor | null> {
  const doc = await fetchActorDocument(uri, signer);
  if (!doc) return null;
  if (doc.id === uri) return isSelfConsistent(doc, preferredKeyId) ? doc : null;
  const canonical = await fetchActorDocument(doc.id!, signer);
  if (!canonical || canonical.id !== doc.id) return null;
  return isSelfConsistent(canonical, preferredKeyId) ? canonical : null;
}

/**
 * 鍵がそのアクター自身のもの(owner 一致・同一オリジン)であること。
 * 実装によっては publicKey を配列で公開するため、本人の鍵を 1 つ選んで
 * doc.publicKey に正規化する(該当が無ければ鍵なしとして扱う)。
 */
function isSelfConsistent(doc: ApActor, preferredKeyId?: string): boolean {
  const raw: unknown = doc.publicKey;
  if (!raw) return true;
  const keys = (Array.isArray(raw) ? raw : [raw]) as Partial<ApPublicKey>[];
  // 単一の鍵が他人のものなら拒否(他人の鍵を主張するなりすまし)
  if (!Array.isArray(raw) && isForeignKey(doc.id!, keys[0]!)) return false;
  const usable = keys.filter(
    (k) => typeof k?.publicKeyPem === 'string' && !isForeignKey(doc.id!, k),
  );
  const own = usable.find((k) => k.id === preferredKeyId) ?? usable[0];
  if (own) doc.publicKey = own as ApPublicKey;
  else delete doc.publicKey;
  return true;
}

/** owner が別アクター、または鍵 id が別オリジンの鍵か */
function isForeignKey(actorId: string, key: Partial<ApPublicKey>): boolean {
  if (key?.owner && key.owner !== actorId) return true;
  if (!key?.id) return false;
  try {
    return new URL(key.id).origin !== new URL(actorId).origin;
  } catch {
    return true;
  }
}

async function fetchActorDocument(
  uri: string,
  signer?: FetchSigner,
): Promise<ApActor | null> {
  if (!isPublicHttpUrl(uri)) return null;
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
  const doc = await fetchRemoteActor(actorUri, opts.signer, keyId);
  if (!doc) return null;
  // なりすまし防止: 取得したアクターは、フェッチ先 URL(= keyId のアクター)
  // 自身であり、鍵の id が keyId と一致していなければならない。
  // これを検証しないと、悪意あるサーバーが他人の URI と鍵を主張して
  // その人物として発話できてしまう。
  if (doc.id !== actorUri) return null;
  if (doc.publicKey && doc.publicKey.id !== keyId) return null;
  return upsertRemoteActor(db, doc);
}
