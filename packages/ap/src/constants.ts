/**
 * ActivityPub / ActivityStreams 2.0 の定数。
 */

/** AS2 の正規 JSON-LD コンテキスト URI */
export const AS_CONTEXT = 'https://www.w3.org/ns/activitystreams' as const;

/** セキュリティ語彙(HTTP Signatures 公開鍵)のコンテキスト URI */
export const SECURITY_CONTEXT = 'https://w3id.org/security/v1' as const;

/** ActivityPub オブジェクトの正規メディアタイプ */
export const AP_MEDIA_TYPE =
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"' as const;

/** 広く使われる別表記(受信時はこちらも受理する) */
export const ACTIVITY_JSON_MEDIA_TYPE = 'application/activity+json' as const;

/** WebFinger JRD のメディアタイプ */
export const JRD_MEDIA_TYPE = 'application/jrd+json' as const;

/** Accept ヘッダが AP オブジェクトを要求しているか判定する */
export function acceptsActivityPub(acceptHeader: string | null | undefined): boolean {
  if (!acceptHeader) return false;
  return (
    acceptHeader.includes('application/activity+json') ||
    (acceptHeader.includes('application/ld+json') &&
      acceptHeader.includes('activitystreams'))
  );
}
