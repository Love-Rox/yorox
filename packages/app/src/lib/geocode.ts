/**
 * 住所 → 座標のジオコーディング(Nominatim / OpenStreetMap)。
 * イベント保存時に一度だけ呼ぶ(表示のたびに外部 API を叩かない)。
 * 利用規約: https://operations.osmfoundation.org/policies/nominatim/
 * - 識別可能な User-Agent を送る / 大量リクエストしない(保存時のみ)
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export async function geocodeAddress(query: string): Promise<GeoPoint | null> {
  if (!query.trim()) return null;
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Yorox/0.0.0 (+https://github.com/Love-Rox/yorox)',
        accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const results = (await res.json()) as { lat: string; lon: string }[];
    const first = results[0];
    if (!first) return null;
    const lat = Number.parseFloat(first.lat);
    const lng = Number.parseFloat(first.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng };
  } catch (err) {
    console.error('[geocode] failed:', err);
    return null;
  }
}
