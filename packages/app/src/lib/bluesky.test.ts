import { describe, expect, it } from 'vitest';
import { buildBskyAnnouncementText } from './bluesky';

describe('buildBskyAnnouncementText', () => {
  const base = {
    startsAt: new Date('2026-08-28T10:00:00Z'),
    venueName: '京都リサーチパーク',
    humanUrl: 'https://yorox.love-rox.cc/g/x/events/01ABC',
  };

  it('タイトル・日時・会場・URL を含む', () => {
    const text = buildBskyAnnouncementText({ ...base, title: 'Yorox ミートアップ' });
    expect(text).toContain('Yorox ミートアップ');
    expect(text).toContain('📅');
    expect(text).toContain('📍 京都リサーチパーク');
    expect(text).toContain(base.humanUrl);
    expect([...text].length).toBeLessThanOrEqual(300);
  });

  it('長いタイトルは 300 文字に収まるよう切り詰める', () => {
    const text = buildBskyAnnouncementText({ ...base, title: 'あ'.repeat(400) });
    expect([...text].length).toBeLessThanOrEqual(300);
    expect(text).toContain('…');
    expect(text).toContain(base.humanUrl);
  });
});
