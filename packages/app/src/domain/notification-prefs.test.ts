import { describe, expect, it } from 'vitest';
import {
  categoryOf,
  channelEnabled,
  effectivePrefs,
  parseNotificationPrefs,
  type PrefUser,
} from './notification-prefs';

const base: PrefUser = {
  emailNotifications: true,
  discordDmNotifications: true,
  discordWebhookUrl: null,
  notificationPrefs: null,
};

describe('categoryOf', () => {
  it('種別をカテゴリに束ねる', () => {
    expect(categoryOf('participation.accepted')).toBe('participation');
    expect(categoryOf('payment.paid')).toBe('payment');
    expect(categoryOf('participation.reminder')).toBe('reminder');
    expect(categoryOf('event.cancelled')).toBe('event_change');
    expect(categoryOf('follow.created')).toBe('social');
    expect(categoryOf('unknown.type')).toBeNull();
  });
});

describe('channelEnabled', () => {
  it('セル未指定は従来設定から既定を導く', () => {
    expect(channelEnabled(base, 'participation', 'email')).toBe(true);
    expect(channelEnabled({ ...base, emailNotifications: false }, 'participation', 'email')).toBe(
      false,
    );
    expect(channelEnabled(base, 'participation', 'discordDm')).toBe(true);
    // Webhook は URL が無ければ既定オフ
    expect(channelEnabled(base, 'participation', 'discordWebhook')).toBe(false);
    expect(
      channelEnabled({ ...base, discordWebhookUrl: 'https://discord.com/api/webhooks/x' }, 'participation', 'discordWebhook'),
    ).toBe(true);
    // AP は明示オプトイン(既定オフ)
    expect(channelEnabled(base, 'participation', 'ap')).toBe(false);
  });

  it('セル指定があれば既定より優先する', () => {
    const user: PrefUser = {
      ...base,
      notificationPrefs: { participation: { email: false, ap: true } },
    };
    expect(channelEnabled(user, 'participation', 'email')).toBe(false);
    expect(channelEnabled(user, 'participation', 'ap')).toBe(true);
    // 指定の無いカテゴリは既定のまま
    expect(channelEnabled(user, 'reminder', 'email')).toBe(true);
  });
});

describe('parseNotificationPrefs / effectivePrefs', () => {
  it('フォームからマトリクスを組み立てる', () => {
    const checked = new Set(['notify_participation_email', 'notify_reminder_discordDm']);
    const prefs = parseNotificationPrefs((f) => checked.has(f));
    expect(prefs.participation?.email).toBe(true);
    expect(prefs.participation?.discordDm).toBe(false);
    expect(prefs.reminder?.discordDm).toBe(true);
  });

  it('全セルの実効値を返す', () => {
    const eff = effectivePrefs(base);
    expect(eff['participation_email']).toBe(true);
    expect(eff['participation_ap']).toBe(false);
    expect(Object.keys(eff)).toHaveLength(5 * 4);
  });
});
