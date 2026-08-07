/**
 * ゼロ依存の ULID 生成。
 *
 * ID は全エンティティで ULID(26文字 Crockford Base32)を使う。
 * 辞書順 = 時系列順になるため、D1 の主キーとして挿入局所性が良く、
 * AP オブジェクト URI の不変 ID 部分としてもそのまま使える。
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now: number = Date.now()): string {
  let time = now;
  const chars = new Array<string>(26);
  // 先頭10文字: 48bit タイムスタンプ
  for (let i = 9; i >= 0; i--) {
    chars[i] = ENCODING[time % 32]!;
    time = Math.floor(time / 32);
  }
  // 残り16文字: 80bit ランダム
  const rand = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) {
    chars[10 + i] = ENCODING[rand[i]! % 32]!;
  }
  return chars.join('');
}
