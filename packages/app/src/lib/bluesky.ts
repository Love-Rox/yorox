/**
 * Bluesky(AT Protocol)クライアント(最小限)。
 * - 公開 API でのプロフィール取得(アカウント連携の検証用)
 * - App Password でのセッション作成とイベント告知のクロスポスト
 * ネイティブ連合はしない(ブリッジ経由の AP アカウントは既存実装で扱える)。
 */

const PUBLIC_API = 'https://public.api.bsky.app';
const PDS_API = 'https://bsky.social';
const TIMEOUT_MS = 10_000;

export interface BskyProfile {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
}

/** 公開 API でプロフィールを取得する(認証不要) */
export async function fetchBskyProfile(handle: string): Promise<BskyProfile | null> {
  try {
    const res = await fetch(
      `${PUBLIC_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    return (await res.json()) as BskyProfile;
  } catch {
    return null;
  }
}

interface BskySession {
  did: string;
  accessJwt: string;
}

/** App Password でログインする(失敗時 null) */
export async function createBskySession(
  identifier: string,
  appPassword: string,
): Promise<BskySession | null> {
  try {
    const res = await fetch(`${PDS_API}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password: appPassword }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { did?: string; accessJwt?: string };
    if (!data.did || !data.accessJwt) return null;
    return { did: data.did, accessJwt: data.accessJwt };
  } catch {
    return null;
  }
}

/** UTF-8 バイト長(facets のオフセットはバイト単位) */
function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * テキストを投稿する。URL にはリンク facet を張る。
 * @returns 投稿の URI(at://…)。失敗時 null
 */
export async function postToBluesky(
  session: BskySession,
  text: string,
  linkUrl: string,
): Promise<string | null> {
  const linkStart = text.indexOf(linkUrl);
  const facets =
    linkStart >= 0
      ? [
          {
            index: {
              byteStart: byteLen(text.slice(0, linkStart)),
              byteEnd: byteLen(text.slice(0, linkStart + linkUrl.length)),
            },
            features: [{ $type: 'app.bsky.richtext.facet#link', uri: linkUrl }],
          },
        ]
      : [];
  try {
    const res = await fetch(`${PDS_API}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text,
          facets,
          createdAt: new Date().toISOString(),
          langs: ['ja'],
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn('[bsky] post failed:', res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { uri?: string };
    return data.uri ?? null;
  } catch (err) {
    console.warn('[bsky] post failed:', err);
    return null;
  }
}

const POST_DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
});

/** イベント告知の投稿本文(Bluesky は 300 文字上限) */
export function buildBskyAnnouncementText(event: {
  title: string;
  startsAt: Date;
  venueName: string | null;
  humanUrl: string;
}): string {
  const fixed = `\n📅 ${POST_DATE_FMT.format(event.startsAt)}${
    event.venueName ? `\n📍 ${event.venueName}` : ''
  }\n${event.humanUrl}`;
  const budget = 300 - [...fixed].length;
  const title =
    [...event.title].length > budget
      ? [...event.title].slice(0, Math.max(0, budget - 1)).join('') + '…'
      : event.title;
  return title + fixed;
}
