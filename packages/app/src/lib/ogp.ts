/**
 * イベントの OGP 画像を SVG で動的生成する(ゼロ依存)。
 *
 * satori / resvg 等の重い wasm を持ち込まず、SVG を直接組み立てる。
 * SVG の og:image は Fediverse(Mastodon/Misskey)・Discord・Slack・Telegram
 * などでプレビューされる。X/Facebook は SVG を展開しないため、確実な
 * ラスタカードが要るイベントは主催がサムネイル画像を設定する運用とする。
 */

const WIDTH = 1200;
const HEIGHT = 630;

// リソグラフ配色(tokens.css の sRGB 近似)
const PAPER = '#f4f0e4';
const INK = '#23283a';
const ACCENT = '#e8446b';
const ACCENT2 = '#35507e';
const RULE = '#d8cfbe';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 文字の概算幅(フォントサイズ基準)。全角=1.0、半角=0.55 として折り返しを見積る */
function charWidth(ch: string): number {
  // ざっくり: ASCII と半角記号は狭い、それ以外(CJK 等)は全角扱い
  return /[\x20-\x7e｡-ﾟ]/.test(ch) ? 0.55 : 1.0;
}

/** maxWidthPx に収まるよう title を最大 maxLines 行に折り返す(超過は … で省略) */
function wrapText(
  text: string,
  fontSize: number,
  maxWidthPx: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = '';
  let lineW = 0;
  const flush = () => {
    lines.push(line);
    line = '';
    lineW = 0;
  };
  for (const ch of text) {
    if (ch === '\n') {
      if (lines.length + 1 >= maxLines) break;
      flush();
      continue;
    }
    const w = charWidth(ch) * fontSize;
    if (lineW + w > maxWidthPx) {
      if (lines.length + 1 >= maxLines) {
        // 最終行: 収まるところまで詰めて省略記号
        while (line && lineW + charWidth('…') * fontSize > maxWidthPx) {
          const last = [...line].pop() as string;
          line = line.slice(0, line.length - last.length);
          lineW -= charWidth(last) * fontSize;
        }
        line += '…';
        flush();
        return lines;
      }
      flush();
    }
    line += ch;
    lineW += w;
  }
  if (line) flush();
  return lines.slice(0, maxLines);
}

export interface EventOgInput {
  title: string;
  dateText: string;
  groupName: string;
  venue?: string | null;
  siteName?: string;
}

/** イベント OGP カードの SVG 文字列を返す(1200×630) */
export function buildEventOgSvg(input: EventOgInput): string {
  const pad = 80;
  const contentW = WIDTH - pad * 2;
  const titleSize = 66;
  const titleLines = wrapText(input.title, titleSize, contentW, 3);
  const lineHeight = titleSize * 1.28;
  const titleTop = 210;

  const titleTspans = titleLines
    .map(
      (ln, i) =>
        `<tspan x="${pad}" y="${titleTop + i * lineHeight}">${escapeXml(ln)}</tspan>`,
    )
    .join('');

  const metaY = titleTop + titleLines.length * lineHeight + 36;
  const venueLine = input.venue
    ? `<text x="${pad}" y="${metaY + 52}" font-family="sans-serif" font-size="32" fill="${INK}" opacity="0.8">${escapeXml(input.venue)}</text>`
    : '';
  const site = escapeXml(input.siteName ?? 'Yorox');

  // 版ズレ風のアクセント帯 + 上部にサイト名・グループ名
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
  <rect x="0" y="0" width="${WIDTH}" height="16" fill="${ACCENT}"/>
  <rect x="0" y="16" width="${WIDTH}" height="6" fill="${ACCENT2}"/>
  <text x="${pad}" y="108" font-family="sans-serif" font-size="34" font-weight="700" fill="${ACCENT}" letter-spacing="1">${site}</text>
  <text x="${pad}" y="152" font-family="sans-serif" font-size="30" fill="${ACCENT2}">${escapeXml(input.groupName)}</text>
  <line x1="${pad}" y1="176" x2="${WIDTH - pad}" y2="176" stroke="${RULE}" stroke-width="2"/>
  <text font-family="sans-serif" font-size="${titleSize}" font-weight="700" fill="${INK}">${titleTspans}</text>
  <text x="${pad}" y="${metaY}" font-family="sans-serif" font-size="36" font-weight="700" fill="${ACCENT2}">${escapeXml(input.dateText)}</text>
  ${venueLine}
  <rect x="0" y="${HEIGHT - 14}" width="${WIDTH}" height="14" fill="${ACCENT2}"/>
</svg>`;
}
