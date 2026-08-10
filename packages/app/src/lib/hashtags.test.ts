import { describe, expect, it } from 'vitest';
import { formatHashtags, parseHashtags, resolveHashtags, shareText } from './hashtags';

describe('parseHashtags', () => {
  it('# の有無・区切り文字を吸収して正規化する', () => {
    expect(parseHashtags('#yorox 京都 , #勉強会')).toEqual(['yorox', '京都', '勉強会']);
  });

  it('全角 # と改行も扱える', () => {
    expect(parseHashtags('＃テスト\n#dev')).toEqual(['テスト', 'dev']);
  });

  it('重複(大文字小文字違い)を除く', () => {
    expect(parseHashtags('Yorox yorox YOROX')).toEqual(['Yorox']);
  });

  it('最大5個まで', () => {
    expect(parseHashtags('a b c d e f g')).toHaveLength(5);
  });

  it('空文字や記号のみは無視する', () => {
    expect(parseHashtags('  ,, ## ')).toEqual([]);
  });
});

describe('resolveHashtags', () => {
  it('イベント側が優先される', () => {
    expect(resolveHashtags(['ev'], ['grp'])).toEqual(['ev']);
  });
  it('イベント未設定ならグループ既定を使う', () => {
    expect(resolveHashtags([], ['grp'])).toEqual(['grp']);
    expect(resolveHashtags(null, ['grp'])).toEqual(['grp']);
  });
  it('どちらも無ければ空', () => {
    expect(resolveHashtags(null, null)).toEqual([]);
  });
});

describe('formatHashtags / shareText', () => {
  it('# を付けて連結する', () => {
    expect(formatHashtags(['a', 'b'])).toBe('#a #b');
  });
  it('タグが無ければタイトルのみ', () => {
    expect(shareText('イベント', [])).toBe('イベント');
  });
  it('タイトルにタグを添える', () => {
    expect(shareText('イベント', ['yorox'])).toBe('イベント #yorox');
  });
});
