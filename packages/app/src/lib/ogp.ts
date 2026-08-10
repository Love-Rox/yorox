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

export interface ActorOgInput {
  name: string;
  handle: string;
  /** 'グループ' | '個人グループ' | '個人' 等の種別ラベル */
  kindLabel: string;
  subtitle?: string | null;
  siteName?: string;
}

/** グループ/ユーザー用の OGP カード SVG(1200×630) */
export function buildActorOgSvg(input: ActorOgInput): string {
  const pad = 80;
  const contentW = WIDTH - pad * 2;
  const nameSize = 66;
  const nameLines = wrapText(input.name, nameSize, contentW, 2);
  const lineHeight = nameSize * 1.34;
  const logoSize = 64;
  const logoY = 52;
  const site = escapeXml(input.siteName ?? 'Yorox');
  const ruleY = 196;
  const nameFirstBaseline = ruleY + 78;
  const nameTspans = nameLines
    .map((ln, i) => `<tspan x="${pad}" y="${nameFirstBaseline + i * lineHeight}">${escapeXml(ln)}</tspan>`)
    .join('');
  const nameBottom = nameFirstBaseline + (nameLines.length - 1) * lineHeight;
  const subLine = input.subtitle
    ? `<text x="${pad}" y="${nameBottom + 100}" font-family="sans-serif" font-size="30" fill="${INK}" opacity="0.8">${escapeXml(input.subtitle)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
  <rect x="0" y="0" width="${WIDTH}" height="16" fill="${ACCENT}"/>
  <rect x="0" y="16" width="${WIDTH}" height="6" fill="${ACCENT2}"/>
  ${logoMark(pad, logoY, logoSize)}
  <text x="${pad + logoSize + 20}" y="${logoY + logoSize * 0.72}" font-family="sans-serif" font-size="40" font-weight="700" fill="${ACCENT}" letter-spacing="1">${site}</text>
  <text x="${pad}" y="${ruleY - 20}" font-family="sans-serif" font-size="30" fill="${ACCENT2}">${escapeXml(input.kindLabel)}</text>
  <line x1="${pad}" y1="${ruleY}" x2="${WIDTH - pad}" y2="${ruleY}" stroke="${RULE}" stroke-width="2"/>
  <text font-family="sans-serif" font-size="${nameSize}" font-weight="700" fill="${INK}">${nameTspans}</text>
  <text x="${pad}" y="${nameBottom + 54}" font-family="monospace" font-size="34" fill="${ACCENT2}">@${escapeXml(input.handle)}</text>
  ${subLine}
  <rect x="0" y="${HEIGHT - 14}" width="${WIDTH}" height="14" fill="${ACCENT2}"/>
</svg>`;
}

/** ロゴマーク(角丸タイル + 版ズレ Y)を (x,y) に size で描く */
function logoMark(x: number, y: number, size: number): string {
  const s = size / 512;
  const yPath = 'M146 128 L256 262 M366 128 L256 262 M256 262 L256 396';
  return `<g transform="translate(${x},${y}) scale(${s})">
    <rect width="512" height="512" rx="104" fill="${INK}"/>
    <path d="${yPath}" fill="none" stroke="${ACCENT}" stroke-width="92" stroke-linecap="round" stroke-linejoin="round" transform="translate(-12,-9)"/>
    <path d="${yPath}" fill="none" stroke="${PAPER}" stroke-width="92" stroke-linecap="round" stroke-linejoin="round" transform="translate(8,8)"/>
  </g>`;
}

/** イベント OGP カードの SVG 文字列を返す(1200×630) */
export function buildEventOgSvg(input: EventOgInput): string {
  const pad = 80;
  const contentW = WIDTH - pad * 2;
  const titleSize = 62;
  const titleLines = wrapText(input.title, titleSize, contentW, 3);
  const lineHeight = titleSize * 1.34;

  // ヘッダー: ロゴマーク + サービス名
  const logoSize = 64;
  const logoY = 52;
  const site = escapeXml(input.siteName ?? 'Yorox');

  // 仕切り線とタイトルの間に十分な余白を取る(線が文字に重ならないよう)
  const ruleY = 196;
  const titleFirstBaseline = ruleY + 76;
  const titleTspans = titleLines
    .map(
      (ln, i) =>
        `<tspan x="${pad}" y="${titleFirstBaseline + i * lineHeight}">${escapeXml(ln)}</tspan>`,
    )
    .join('');

  const titleBottom = titleFirstBaseline + (titleLines.length - 1) * lineHeight;
  const dateY = titleBottom + 84;
  const venueLine = input.venue
    ? `<text x="${pad}" y="${dateY + 50}" font-family="sans-serif" font-size="30" fill="${INK}" opacity="0.8">${escapeXml(input.venue)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
  <rect x="0" y="0" width="${WIDTH}" height="16" fill="${ACCENT}"/>
  <rect x="0" y="16" width="${WIDTH}" height="6" fill="${ACCENT2}"/>
  ${logoMark(pad, logoY, logoSize)}
  <text x="${pad + logoSize + 20}" y="${logoY + logoSize * 0.72}" font-family="sans-serif" font-size="40" font-weight="700" fill="${ACCENT}" letter-spacing="1">${site}</text>
  <text x="${pad}" y="${ruleY - 20}" font-family="sans-serif" font-size="30" fill="${ACCENT2}">${escapeXml(input.groupName)}</text>
  <line x1="${pad}" y1="${ruleY}" x2="${WIDTH - pad}" y2="${ruleY}" stroke="${RULE}" stroke-width="2"/>
  <text font-family="sans-serif" font-size="${titleSize}" font-weight="700" fill="${INK}">${titleTspans}</text>
  <text x="${pad}" y="${dateY}" font-family="sans-serif" font-size="36" font-weight="700" fill="${ACCENT2}">${escapeXml(input.dateText)}</text>
  ${venueLine}
  <rect x="0" y="${HEIGHT - 14}" width="${WIDTH}" height="14" fill="${ACCENT2}"/>
</svg>`;
}
