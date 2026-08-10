/**
 * OGP 画像の共通処理。SVG を og-renderer(service binding)で PNG 化し、
 * R2(FILES)にキャッシュして返す。レンダラ未接続/失敗時は null を返し、
 * 呼び出し側が SVG などにフォールバックする。
 */
const PNG_HEADERS = { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' };

export async function renderOgPngResponse(
  env: Env,
  cacheKey: string,
  svg: string,
): Promise<Response | null> {
  const cached = await env.FILES?.get(cacheKey);
  if (cached) return new Response(cached.body, { status: 200, headers: PNG_HEADERS });
  try {
    const res = await env.OG_RENDERER.fetch(
      new Request('https://og-renderer/render', { method: 'POST', body: svg }),
    );
    if (!res.ok) throw new Error(`renderer ${res.status}`);
    const png = new Uint8Array(await res.arrayBuffer());
    await env.FILES?.put(cacheKey, png, { httpMetadata: { contentType: 'image/png' } });
    return new Response(png, { status: 200, headers: PNG_HEADERS });
  } catch (err) {
    console.error('[ogp] PNG 生成に失敗:', err);
    return null;
  }
}
