import { describe, expect, it } from 'vitest';
import { eventIdFromUri, parseReplyCommand } from './remote-join';

describe('eventIdFromUri', () => {
  it('イベント URI と告知 Note URI から ID を取り出す', () => {
    expect(eventIdFromUri('https://yorox.example/events/01KZGR0VGKRAPC6S2D17G7V34Q')).toBe(
      '01KZGR0VGKRAPC6S2D17G7V34Q',
    );
    expect(
      eventIdFromUri('https://yorox.example/events/01KZGR0VGKRAPC6S2D17G7V34Q/note'),
    ).toBe('01KZGR0VGKRAPC6S2D17G7V34Q');
  });

  it('イベント以外の URI は null', () => {
    expect(eventIdFromUri('https://yorox.example/groups/01KZGR0VGKRAPC6S2D17G7V34Q')).toBeNull();
    expect(eventIdFromUri('https://yorox.example/events/new')).toBeNull();
    expect(eventIdFromUri('https://remote.example/notes/abc')).toBeNull();
  });
});

describe('parseReplyCommand', () => {
  it('「参加」系を join と判定する', () => {
    expect(parseReplyCommand('<p>参加</p>')).toBe('join');
    expect(parseReplyCommand('<p>参加します!</p>')).toBe('join');
    expect(parseReplyCommand('<p>join</p>')).toBe('join');
    expect(parseReplyCommand('<p>JOIN</p>')).toBe('join');
  });

  it('メンション付きリプライでも判定できる(Misskey 形式)', () => {
    expect(
      parseReplyCommand(
        '<p><a href="https://yorox.example/g/x" class="u-url mention">@sasapiyo@yorox.love-rox.cc</a> 参加します</p>',
      ),
    ).toBe('join');
  });

  it('「キャンセル」系を cancel と判定する', () => {
    expect(parseReplyCommand('<p>キャンセル</p>')).toBe('cancel');
    expect(parseReplyCommand('<p>cancel</p>')).toBe('cancel');
    expect(parseReplyCommand('<p>不参加でお願いします</p>')).toBe('cancel');
  });

  it('コマンドでないリプライは null(ただの感想は無視)', () => {
    expect(parseReplyCommand('<p>楽しみにしています!</p>')).toBeNull();
    expect(parseReplyCommand('<p>会場はどこですか?</p>')).toBeNull();
    expect(parseReplyCommand('')).toBeNull();
  });
});
