/**
 * OG 画像レンダラ Worker。SVG を受け取り PNG を返す(resvg-wasm)。
 * wasm は wrangler が CompiledWasm として静的にコンパイルするため、
 * Workers の「実行時 wasm コンパイル禁止」制約に当たらない。
 * app からは service binding(OG_RENDERER)経由の POST で呼ぶ。
 */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import fontData from './assets/font.ttf';

let inited = false;
async function ensureWasm(): Promise<void> {
  if (!inited) {
    await initWasm(resvgWasm);
    inited = true;
  }
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const svg = await req.text();
    if (!svg.trim()) return new Response('empty svg', { status: 400 });
    try {
      await ensureWasm();
      const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: 1200 },
        font: {
          fontBuffers: [new Uint8Array(fontData)],
          defaultFontFamily: 'M PLUS Rounded 1c',
          loadSystemFonts: false,
        },
      });
      const png = resvg.render().asPng();
      const out = new Uint8Array(png.byteLength);
      out.set(png);
      return new Response(out, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    } catch (e) {
      return new Response(`render error: ${String(e)}`, { status: 500 });
    }
  },
} satisfies ExportedHandler;
