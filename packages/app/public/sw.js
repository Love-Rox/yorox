/**
 * Yorox Service Worker(控えめ運用)。
 * - ナビゲーション: network-first。失敗時のみ offline.html
 * - ハッシュ付きアセット(/assets/)と画像・フォント: cache-first
 * - RSC ペイロード・API・POST は一切キャッシュしない
 */
const CACHE = 'yorox-v2';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/images/logo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        for (const url of PRECACHE) {
          // 配信側のリダイレクト(.html 正規化)で redirected フラグが付くと
          // ナビゲーションへの応答に使えないため、素の Response に詰め替える
          const res = await fetch(url, { cache: 'no-cache' });
          if (!res.ok) continue;
          const body = await res.blob();
          await cache.put(
            url,
            new Response(body, {
              headers: { 'content-type': res.headers.get('content-type') || 'text/html; charset=utf-8' },
            }),
          );
        }
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** 静的アセットか(ハッシュ付きなので永続キャッシュして安全) */
function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/images/') ||
      url.pathname === '/favicon.ico' ||
      url.pathname === '/site.webmanifest')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 静的アセット: cache-first
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // ページ遷移: network-first、失敗時 offline ページ
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((page) => page || Response.error()),
      ),
    );
  }
  // それ以外(RSC・fetch API 等)は SW を素通し
});
