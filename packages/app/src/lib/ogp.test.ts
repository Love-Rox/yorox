import { describe, expect, it } from 'vitest';
import { buildEventOgSvg } from './ogp';

describe('buildEventOgSvg', () => {
  it('1200×630 の SVG を返す', () => {
    const svg = buildEventOgSvg({
      title: 'テストイベント',
      dateText: '2026年8月9日 19:00',
      groupName: 'テストグループ',
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain('テストイベント');
  });

  it('XML 特殊文字をエスケープする(インジェクション防止)', () => {
    const svg = buildEventOgSvg({
      title: '<script>&"x"',
      dateText: '2026',
      groupName: 'g',
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;');
  });

  it('長いタイトルは3行までに折り返して省略する', () => {
    const svg = buildEventOgSvg({
      title: 'あ'.repeat(200),
      dateText: '2026',
      groupName: 'g',
    });
    const tspans = svg.match(/<tspan/g) ?? [];
    expect(tspans.length).toBeLessThanOrEqual(3);
    expect(svg).toContain('…');
  });

  it('会場を指定すると描画に含まれる', () => {
    const svg = buildEventOgSvg({
      title: 't',
      dateText: '2026',
      groupName: 'g',
      venue: 'オンライン開催',
    });
    expect(svg).toContain('オンライン開催');
  });
});
