/**
 * claim: リモートエイリアスアカウントを Yorox アカウントに紐付ける。
 *
 * 方式1(ワンタイムコード): 設定画面でコードを発行し、リモートアカウントから
 * コードをメンション投稿する。inbox の署名検証がリモート側の本人性を、
 * ログインセッションがローカル側の本人性を担保する。
 *
 * 方式2(rel=me): リモートプロフィールのリンク欄に自分の Yorox プロフィール
 * URL を載せてもらい、こちらから取得して確認する。リンクの掲載 = リモート側
 * オーナーの同意とみなせる(Mastodon のリンク検証と同じ考え方)。
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { ApActor } from '@yorox/ap';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { hashToken } from '../lib/token';
import { ulid } from '../lib/ulid';
import { fetchBskyProfile } from '../lib/bluesky';
import { getInstanceActorSigner } from '../lib/instance-actor';
import { fetchRemoteActor, upsertRemoteActor } from '../lib/remote-actor';

const CODE_TTL_MS = 30 * 60 * 1000;
/** 投稿本文から拾うコード形式 */
const CODE_RE = /yorox-([a-z0-9]{8})/i;

function randomCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `yorox-${out}`;
}

/** ワンタイムコードを発行する(既存の未使用コードは失効させる) */
export async function generateClaimCode(
  db: Db,
  userActorId: string,
  now: Date = new Date(),
): Promise<string> {
  await db
    .delete(schema.claimCodes)
    .where(
      and(eq(schema.claimCodes.userActorId, userActorId), isNull(schema.claimCodes.usedAt)),
    );
  const code = randomCode();
  await db.insert(schema.claimCodes).values({
    id: ulid(),
    userActorId,
    codeHash: await hashToken(code),
    createdAt: now,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });
  return code;
}

/** リモートエイリアスをローカルユーザーに紐付ける */
export async function linkRemoteAlias(
  db: Db,
  remoteActorId: string,
  userActorId: string,
): Promise<void> {
  await db
    .update(schema.actors)
    .set({ claimedByActorId: userActorId, state: 'remote_claimed', updatedAt: new Date() })
    .where(eq(schema.actors.id, remoteActorId));
}

/**
 * 受信 Note の本文から claim コードを検出して紐付ける。
 * @returns 紐付けたら紐付け先ユーザーの actor 行、コードが無ければ null
 */
export async function claimByCode(
  db: Db,
  remoteActor: { id: string; state: string },
  contentHtml: string,
  now: Date = new Date(),
): Promise<{ userActorId: string } | 'invalid' | null> {
  const m = CODE_RE.exec(contentHtml.replace(/<[^>]*>/g, ' '));
  if (!m) return null;
  if (remoteActor.state === 'local') return 'invalid';
  const codeHash = await hashToken(m[0]!.toLowerCase());
  // 条件付き UPDATE で単一使用を保証(マジックリンクと同じパターン)
  const result = await db
    .update(schema.claimCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.claimCodes.codeHash, codeHash),
        isNull(schema.claimCodes.usedAt),
        gt(schema.claimCodes.expiresAt, now),
      ),
    )
    .returning({ userActorId: schema.claimCodes.userActorId });
  const row = result[0];
  if (!row) return 'invalid';
  await linkRemoteAlias(db, remoteActor.id, row.userActorId);
  return { userActorId: row.userActorId };
}

/** webfinger で acct:user@host からアクター URI を解決する */
async function resolveAcct(handle: string, domain: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${handle}@${domain}`)}`,
      {
        headers: { accept: 'application/jrd+json, application/json' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const jrd = (await res.json()) as {
      links?: { rel: string; type?: string; href?: string }[];
    };
    return (
      jrd.links?.find(
        (l) => l.rel === 'self' && (l.type?.includes('activity+json') ?? false),
      )?.href ?? null
    );
  } catch {
    return null;
  }
}

export type RelMeResult =
  | { ok: true; remoteActorId: string; remoteHandle: string }
  | { ok: false; reason: string };

/**
 * rel=me 方式の確認: リモートプロフィールが自分の Yorox プロフィール URL を
 * リンクしていることを確認して紐付ける。
 * @param remoteRef `@user@host` または アクター/プロフィール URL
 * @param profileUrls 認めるリンク先(例: https://host/u/handle と https://host/@handle)
 */
export async function claimByRelMe(
  db: Db,
  userActorId: string,
  remoteRef: string,
  profileUrls: string[],
): Promise<RelMeResult> {
  const origin = new URL(profileUrls[0]!).origin;
  const fetchSigner = await getInstanceActorSigner(db, origin);
  let actorUri: string | null = null;
  const acctMatch = /^@?([^@\s]+)@([^@\s]+)$/.exec(remoteRef.trim());
  if (acctMatch) {
    actorUri = await resolveAcct(acctMatch[1]!, acctMatch[2]!);
    if (!actorUri) return { ok: false, reason: 'アカウントを webfinger で解決できませんでした' };
  } else if (/^https?:\/\//.test(remoteRef.trim())) {
    actorUri = remoteRef.trim();
  } else {
    return { ok: false, reason: '「@user@host」形式か URL を入力してください' };
  }

  const doc = await fetchRemoteActor(actorUri, fetchSigner);
  if (!doc) return { ok: false, reason: 'リモートアカウントを取得できませんでした' };

  if (!actorLinksTo(doc, profileUrls)) {
    return {
      ok: false,
      reason:
        'リモートプロフィールにあなたの Yorox プロフィール URL が見つかりませんでした。プロフィールのリンク欄(メタデータ)に追加してから再度お試しください。',
    };
  }

  const row = await upsertRemoteActor(db, doc);
  if (row.state === 'local') return { ok: false, reason: 'ローカルアカウントは紐付けできません' };
  await linkRemoteAlias(db, row.id, userActorId);
  return {
    ok: true,
    remoteActorId: row.id,
    remoteHandle: row.handle && row.domain ? `@${row.handle}@${row.domain}` : row.uri,
  };
}


/**
 * Bluesky アカウントの連携。プロフィールの説明文に自分の Yorox プロフィール URL が
 * 書かれていることを確認して紐付ける(rel=me と同じ考え方)。
 */
export async function claimBluesky(
  db: Db,
  userActorId: string,
  bskyHandle: string,
  profileUrls: string[],
): Promise<RelMeResult> {
  const handle = bskyHandle.trim().replace(/^@/, '');
  if (!handle) return { ok: false, reason: 'Bluesky ハンドルを入力してください' };
  const profile = await fetchBskyProfile(handle);
  if (!profile) return { ok: false, reason: 'Bluesky アカウントが見つかりませんでした' };

  const description = profile.description ?? '';
  const targets = profileUrls.map((u) => u.replace(/\/$/, ''));
  if (!targets.some((t) => description.includes(t))) {
    return {
      ok: false,
      reason:
        'Bluesky プロフィールの説明文にあなたの Yorox プロフィール URL が見つかりませんでした。説明文に追加してから再度お試しください。',
    };
  }

  const uri = `https://bsky.app/profile/${profile.did}`;
  const now = new Date();
  const existing = await db.query.actors.findFirst({
    where: eq(schema.actors.uri, uri),
  });
  let actorId: string;
  if (existing) {
    if (existing.state === 'local') return { ok: false, reason: '連携できないアカウントです' };
    actorId = existing.id;
    await db
      .update(schema.actors)
      .set({
        handle: profile.handle,
        displayName: profile.displayName || profile.handle,
        avatarUrl: profile.avatar ?? null,
        updatedAt: now,
      })
      .where(eq(schema.actors.id, actorId));
  } else {
    actorId = ulid();
    await db.insert(schema.actors).values({
      id: actorId,
      kind: 'user',
      state: 'remote_unclaimed',
      handle: profile.handle,
      domain: 'bsky',
      uri,
      displayName: profile.displayName || profile.handle,
      avatarUrl: profile.avatar ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }
  await linkRemoteAlias(db, actorId, userActorId);
  return { ok: true, remoteActorId: actorId, remoteHandle: `@${profile.handle}` };
}

/** アクター文書のリンク欄(attachment PropertyValue / alsoKnownAs / url)に対象 URL があるか */
export function actorLinksTo(doc: ApActor, targetUrls: string[]): boolean {
  const targets = targetUrls.map((u) => u.replace(/\/$/, ''));
  const haystacks: string[] = [];
  const attachments = doc.attachment;
  if (Array.isArray(attachments)) {
    for (const a of attachments as Record<string, unknown>[]) {
      if (typeof a.value === 'string') haystacks.push(a.value);
      if (typeof a.href === 'string') haystacks.push(a.href);
    }
  }
  if (Array.isArray(doc.alsoKnownAs)) haystacks.push(...doc.alsoKnownAs);
  if (typeof doc.url === 'string') haystacks.push(doc.url);
  return targets.some((t) => haystacks.some((h) => h.includes(t)));
}

/** 自分に紐付いたリモートエイリアス一覧 */
export async function listClaimedAliases(db: Db, userActorId: string) {
  return db.query.actors.findMany({
    where: eq(schema.actors.claimedByActorId, userActorId),
  });
}

/** 紐付け解除 */
export async function unlinkRemoteAlias(
  db: Db,
  remoteActorId: string,
  userActorId: string,
): Promise<void> {
  await db
    .update(schema.actors)
    .set({ claimedByActorId: null, state: 'remote_unclaimed', updatedAt: new Date() })
    .where(
      and(
        eq(schema.actors.id, remoteActorId),
        eq(schema.actors.claimedByActorId, userActorId),
      ),
    );
}
