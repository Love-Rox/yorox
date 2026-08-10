import { describe, expect, it } from 'vitest';
import { buildIcs, googleCalendarUrl } from './ics';

describe('buildIcs', () => {
  const stamp = new Date('2026-08-01T00:00:00Z');
  it('VEVENT を含む正しい VCALENDAR を作る', () => {
    const ics = buildIcs(
      [
        {
          uid: 'event-01ABC@yorox.example',
          title: 'Kyoto.rb #42',
          start: new Date('2026-08-28T10:00:00Z'),
          end: new Date('2026-08-28T12:00:00Z'),
          location: '京都リサーチパーク',
          url: 'https://yorox.example/g/x/events/01ABC',
        },
      ],
      'Yorox 参加予定',
      stamp,
    );
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:event-01ABC@yorox.example');
    expect(ics).toContain('DTSTART:20260828T100000Z');
    expect(ics).toContain('DTEND:20260828T120000Z');
    expect(ics).toContain('SUMMARY:Kyoto.rb #42');
    expect(ics).toContain('END:VCALENDAR');
    // CRLF 改行
    expect(ics.includes('\r\n')).toBe(true);
  });

  it('特殊文字をエスケープする', () => {
    const ics = buildIcs(
      [
        {
          uid: 'u1',
          title: 'A; B, C\nD',
          start: new Date('2026-08-28T10:00:00Z'),
        },
      ],
      'cal',
      stamp,
    );
    expect(ics).toContain('SUMMARY:A\\; B\\, C\\nD');
  });
});

describe('googleCalendarUrl', () => {
  it('TEMPLATE リンクに日時を UTC で載せる', () => {
    const url = googleCalendarUrl({
      title: 'Test',
      start: new Date('2026-08-28T10:00:00Z'),
      end: new Date('2026-08-28T12:00:00Z'),
      location: '京都',
    });
    expect(url).toContain('action=TEMPLATE');
    expect(url).toContain('dates=20260828T100000Z%2F20260828T120000Z');
    expect(url).toContain('location=');
  });

  it('終了時刻がなければ2時間後を既定にする', () => {
    const url = googleCalendarUrl({ title: 'X', start: new Date('2026-08-28T10:00:00Z') });
    expect(url).toContain('dates=20260828T100000Z%2F20260828T120000Z');
  });
});

describe('中止イベント', () => {
  it('STATUS:CANCELLED と【中止】プレフィックスを出す', () => {
    const ics = buildIcs(
      [
        {
          uid: 'e1@example.com',
          title: '勉強会',
          start: new Date('2026-09-01T10:00:00Z'),
          cancelled: true,
        },
      ],
      'テスト',
      new Date('2026-08-01T00:00:00Z'),
    );
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SUMMARY:【中止】勉強会');
  });

  it('通常イベントには STATUS を出さない', () => {
    const ics = buildIcs(
      [{ uid: 'e2@example.com', title: '勉強会', start: new Date('2026-09-01T10:00:00Z') }],
      'テスト',
      new Date('2026-08-01T00:00:00Z'),
    );
    expect(ics).not.toContain('STATUS:CANCELLED');
  });
});
