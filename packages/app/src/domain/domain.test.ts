import { describe, expect, it } from 'vitest';
import { evaluateConditions } from './conditions';
import { resolveRequiredGuildId } from './discord-condition';
import { isDiscordSnowflake } from '../lib/discord';
import { describeSlotConditions } from '../components/slot-conditions';
import { SlotEditBlockedError } from './event-service';
import { looksLikeEmail } from '../auth/email-change';
import { attendanceWeight, drawRandom, drawWeighted } from './lottery';
import { hasAllPermissions, PRESET_ROLES } from './permissions';
import { validateHandle } from './groups';
import { ulid } from '../lib/ulid';

describe('ulid', () => {
  it('26文字の Crockford Base32 を生成する', () => {
    const id = ulid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('時系列順に整列する', () => {
    const a = ulid(1000000000000);
    const b = ulid(2000000000000);
    expect(a < b).toBe(true);
  });
});

describe('evaluateConditions', () => {
  const baseApplicant = {
    state: 'local' as const,
    createdAt: new Date('2026-01-01'),
    attendedCount: 5,
  };
  const now = new Date('2026-08-08');

  it('条件なしは常に ok', () => {
    expect(evaluateConditions(null, baseApplicant, now).ok).toBe(true);
  });

  it('requireClaimed: 未claimリモートを拒否し理由を返す', () => {
    const result = evaluateConditions(
      { requireClaimed: true },
      { ...baseApplicant, state: 'remote_unclaimed' },
      now,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('連携');
  });

  it('requireClaimed: claim済みリモートは通す', () => {
    const result = evaluateConditions(
      { requireClaimed: true },
      { ...baseApplicant, state: 'remote_claimed' },
      now,
    );
    expect(result.ok).toBe(true);
  });

  it('minAccountAgeDays: 若いアカウントを拒否', () => {
    const result = evaluateConditions(
      { minAccountAgeDays: 30 },
      { ...baseApplicant, createdAt: new Date('2026-08-01') },
      now,
    );
    expect(result.ok).toBe(false);
  });

  it('minAttendedCount: 実績不足を拒否', () => {
    const result = evaluateConditions(
      { minAttendedCount: 10 },
      baseApplicant,
      now,
    );
    expect(result.ok).toBe(false);
  });

  it('AND 組合せ: 全部満たせば ok', () => {
    const result = evaluateConditions(
      { requireClaimed: true, minAccountAgeDays: 30, minAttendedCount: 3 },
      baseApplicant,
      now,
    );
    expect(result.ok).toBe(true);
  });
});

describe('drawRandom', () => {
  const applicants = Array.from({ length: 10 }, (_, i) => ({ participationId: `p${i}` }));

  it('定員ちょうど当選する', () => {
    const winners = drawRandom(applicants, 3);
    expect(winners.size).toBe(3);
  });

  it('申込者が定員以下なら全員当選', () => {
    const winners = drawRandom(applicants.slice(0, 2), 5);
    expect(winners.size).toBe(2);
  });
});

describe('attendanceWeight', () => {
  it('実績が少なければ中立 (0.5)', () => {
    expect(attendanceWeight({ participationId: 'p', attendedCount: 1, noShowCount: 1 })).toBe(0.5);
  });

  it('全出席は 1.0', () => {
    expect(attendanceWeight({ participationId: 'p', attendedCount: 5, noShowCount: 0 })).toBe(1);
  });

  it('全 no-show でも下限 0.1', () => {
    expect(attendanceWeight({ participationId: 'p', attendedCount: 0, noShowCount: 5 })).toBe(0.1);
  });
});

describe('drawWeighted', () => {
  it('定員ちょうど当選し、重複しない', () => {
    const applicants = Array.from({ length: 10 }, (_, i) => ({
      participationId: `p${i}`,
      attendedCount: i,
      noShowCount: 10 - i,
    }));
    const winners = drawWeighted(applicants, 4);
    expect(winners.size).toBe(4);
  });

  it('出席率の高い申込者が統計的に有利', () => {
    // 固定シードの擬似乱数で決定的にテストする
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const good = { participationId: 'good', attendedCount: 10, noShowCount: 0 }; // w=1.0
    const bad = { participationId: 'bad', attendedCount: 0, noShowCount: 10 }; // w=0.1
    let goodWins = 0;
    for (let i = 0; i < 200; i++) {
      const winners = drawWeighted([good, bad], 1, rand);
      if (winners.has('good')) goodWins++;
    }
    expect(goodWins).toBeGreaterThan(150); // 期待値 ~182 (1.0/1.1)
  });
});

describe('permissions', () => {
  it('オーナープリセットは全権限を持つ', () => {
    const owner = PRESET_ROLES.find((r) => r.name === 'オーナー')!;
    expect(hasAllPermissions(owner.permissions)).toBe(true);
  });

  it('共同主催は member.manage を持たない', () => {
    const co = PRESET_ROLES.find((r) => r.name === '共同主催')!;
    expect(hasAllPermissions(co.permissions)).toBe(false);
    expect(co.permissions).not.toContain('member.manage');
  });
});

describe('validateHandle', () => {
  it('英小文字・数字・ハイフンを許可', () => {
    expect(validateHandle('kyoto-tech')).toBe(true);
    expect(validateHandle('a')).toBe(true);
  });
  it('大文字・記号・前後ハイフンを拒否', () => {
    expect(validateHandle('Kyoto')).toBe(false);
    expect(validateHandle('-abc')).toBe(false);
    expect(validateHandle('abc-')).toBe(false);
    expect(validateHandle('a_b')).toBe(false);
    expect(validateHandle('')).toBe(false);
  });
});

describe('lottery draw with zero/limited seats', () => {
  const applicants = [
    { participationId: 'a' },
    { participationId: 'b' },
    { participationId: 'c' },
  ];

  it('drawRandom: 残席0なら誰も当選しない(定員超過ガード)', () => {
    expect(drawRandom(applicants, 0).size).toBe(0);
  });

  it('drawRandom: 残席は上限どおり', () => {
    expect(drawRandom(applicants, 2).size).toBe(2);
  });

  it('drawWeighted: 残席0なら誰も当選しない', () => {
    expect(drawWeighted(applicants, 0).size).toBe(0);
  });
});

describe('resolveRequiredGuildId', () => {
  it('条件が無効なら null', () => {
    expect(resolveRequiredGuildId({}, '111111111111111111')).toBeNull();
    expect(resolveRequiredGuildId(null, '111111111111111111')).toBeNull();
  });

  it('枠の指定がグループ既定より優先される', () => {
    expect(
      resolveRequiredGuildId(
        { requireDiscordGuild: true, discordGuildId: '222222222222222222' },
        '111111111111111111',
      ),
    ).toBe('222222222222222222');
  });

  it('枠に指定が無ければグループ既定を使う', () => {
    expect(resolveRequiredGuildId({ requireDiscordGuild: true }, '111111111111111111')).toBe(
      '111111111111111111',
    );
  });

  it('どちらも無ければ null(呼び出し側が設定漏れとして弾く)', () => {
    expect(resolveRequiredGuildId({ requireDiscordGuild: true }, null)).toBeNull();
  });
});

describe('isDiscordSnowflake', () => {
  it('17〜20桁の数字だけを受け付ける', () => {
    expect(isDiscordSnowflake('123456789012345678')).toBe(true);
    expect(isDiscordSnowflake('12345678901234567890')).toBe(true);
    expect(isDiscordSnowflake('1234567890123456')).toBe(false); // 16桁
    expect(isDiscordSnowflake('123456789012345678901')).toBe(false); // 21桁
    expect(isDiscordSnowflake('12345678901234567a')).toBe(false);
    expect(isDiscordSnowflake('')).toBe(false);
  });
});

describe('describeSlotConditions', () => {
  it('条件なしは空配列', () => {
    expect(describeSlotConditions(null)).toEqual([]);
    expect(describeSlotConditions({})).toEqual([]);
  });

  it('0 は条件として表示しない', () => {
    expect(describeSlotConditions({ minAccountAgeDays: 0, minAttendedCount: 0 })).toEqual([]);
  });

  it('Discord サーバー条件を含める', () => {
    expect(describeSlotConditions({ requireDiscordGuild: true })).toEqual([
      '指定の Discord サーバーの参加者のみ',
    ]);
  });
});

describe('抽選枠の抽選日時', () => {
  // 抽選日時が無いと cron(isNotNull(lotteryAt) で絞る)が拾わず、
  // 申込者が永久に applied のまま止まる。addSlot / updateSlot で弾く。
  it('SlotEditBlockedError は理由をそのまま message に載せる', () => {
    const err = new SlotEditBlockedError('抽選枠には抽選日時が必要です。');
    expect(err.name).toBe('SlotEditBlockedError');
    expect(err.message).toBe('抽選枠には抽選日時が必要です。');
    expect(err instanceof Error).toBe(true);
  });
});

describe('looksLikeEmail', () => {
  it('通常のアドレスを受け付ける', () => {
    expect(looksLikeEmail('a@example.com')).toBe(true);
    expect(looksLikeEmail('a+tag@sub.example.co.jp')).toBe(true);
  });

  it('形式外・過長を弾く', () => {
    expect(looksLikeEmail('')).toBe(false);
    expect(looksLikeEmail('a@b')).toBe(false); // TLD なし
    expect(looksLikeEmail('a b@example.com')).toBe(false);
    expect(looksLikeEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});
