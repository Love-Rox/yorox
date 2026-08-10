import { describe, expect, it } from 'vitest';
import { buildNotificationBody, formatEventPeriod } from './body';

// JST 2026-08-13(木) 19:00〜21:00
const START = new Date('2026-08-13T10:00:00Z');
const END = new Date('2026-08-13T12:00:00Z');

describe('formatEventPeriod', () => {
  it('同日は終了時刻だけを続ける', () => {
    expect(formatEventPeriod(START, END)).toBe('2026年8月13日(木) 19:00〜21:00');
  });

  it('終了時刻が無ければ開始のみ', () => {
    expect(formatEventPeriod(START, null)).toBe('2026年8月13日(木) 19:00');
  });

  it('日をまたぐときは終了側にも日付を出す', () => {
    const end = new Date('2026-08-14T02:00:00Z'); // JST 8/14 11:00
    expect(formatEventPeriod(START, end)).toBe(
      '2026年8月13日(木) 19:00〜2026年8月14日(金) 11:00',
    );
  });
});

describe('buildNotificationBody', () => {
  const ctx = {
    eventTitle: 'Yorox 開発ミートアップ #1',
    startsAt: START,
    endsAt: END,
    venue: '京都リサーチパーク',
    slotName: '一般',
    url: 'https://yorox.love-rox.cc/e/01ABC',
  };

  it('イベント名・日時・会場・枠名・URL を載せる', () => {
    const body = buildNotificationBody('抽選結果が確定しましたらお知らせします。', ctx);
    expect(body).toContain('抽選結果が確定しましたらお知らせします。');
    expect(body).toContain('■ イベント: Yorox 開発ミートアップ #1');
    expect(body).toContain('■ 日時: 2026年8月13日(木) 19:00〜21:00');
    expect(body).toContain('■ 会場: 京都リサーチパーク');
    expect(body).toContain('■ 参加枠: 一般');
    expect(body.trimEnd().endsWith('https://yorox.love-rox.cc/e/01ABC')).toBe(true);
  });

  it('会場・枠名が無ければその行を出さない', () => {
    const body = buildNotificationBody('本文', {
      ...ctx,
      venue: null,
      slotName: null,
    });
    expect(body).not.toContain('■ 会場');
    expect(body).not.toContain('■ 参加枠');
    expect(body).toContain('■ イベント: Yorox 開発ミートアップ #1');
  });

  it('文脈を解決できなければテンプレートのみ返す', () => {
    expect(buildNotificationBody('本文だけ', null)).toBe('本文だけ');
  });
});
