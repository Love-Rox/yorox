import { describe, expect, it } from 'vitest';
import { computeSendBudget, DEFAULT_RATE_LIMITS, retryBackoffMs } from './queue';

describe('computeSendBudget', () => {
  const limits = { perMinute: 10, perHour: 100 };

  it('実績ゼロなら分上限まで送れる', () => {
    expect(computeSendBudget(limits, 0, 0)).toBe(10);
  });

  it('分上限に達していたら 0', () => {
    expect(computeSendBudget(limits, 10, 10)).toBe(0);
  });

  it('時上限が先に効く', () => {
    expect(computeSendBudget(limits, 0, 95)).toBe(5);
  });

  it('超過していても負にならない', () => {
    expect(computeSendBudget(limits, 15, 200)).toBe(0);
  });

  it('既定値は 10/分・100/時', () => {
    expect(DEFAULT_RATE_LIMITS).toEqual({ perMinute: 10, perHour: 100 });
  });
});

describe('retryBackoffMs', () => {
  it('指数バックオフ: 1分 → 2分 → 4分 → 8分', () => {
    expect(retryBackoffMs(1)).toBe(60_000);
    expect(retryBackoffMs(2)).toBe(120_000);
    expect(retryBackoffMs(3)).toBe(240_000);
    expect(retryBackoffMs(4)).toBe(480_000);
  });
});
