import { describe, expect, it } from 'vitest';
import { evaluateConditions } from './conditions';
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
