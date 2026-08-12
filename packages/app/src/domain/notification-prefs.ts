/**
 * 通知の受け取り方(種別カテゴリ × チャンネル)の定義と判定。
 *
 * ユーザーは「参加状況はメールと Discord、リマインダーはメールだけ」のように
 * カテゴリごとに受け取るチャンネルを選べる。未設定のセルは、従来の
 * emailNotifications / discordDmNotifications / Webhook 有無から既定を導く
 * (既存ユーザーの挙動を変えないため)。
 *
 * AP(Fediverse メンション)は宛先がリモートアクターで、設定画面を持つ
 * ローカルユーザーには適用されないため、ここでは扱わない。
 */
import type { NotificationCategory, NotificationChannel, NotificationPrefs } from '../db/schema';

export const NOTIFICATION_CATEGORIES: {
  key: NotificationCategory;
  label: string;
  description: string;
}[] = [
  { key: 'participation', label: '参加状況', description: '申込受付・参加確定・補欠・繰上・抽選の当落' },
  { key: 'payment', label: '支払い', description: '支払い待ち・入金確認' },
  { key: 'reminder', label: '開催前リマインダー', description: '開催24時間前のお知らせ' },
  { key: 'event_change', label: 'イベントの変更・中止', description: '主催者による中止など' },
  { key: 'social', label: 'フォロー・タイムライン', description: 'フォロー通知・フォロー中グループの公開' },
];

export const NOTIFICATION_CHANNELS: { key: NotificationChannel; label: string }[] = [
  { key: 'email', label: 'メール' },
  { key: 'discordDm', label: 'Discord DM' },
  { key: 'discordWebhook', label: 'Discord Webhook' },
  { key: 'ap', label: '連携 Fediverse' },
];

/** ドメインイベント種別 → カテゴリ */
export function categoryOf(eventType: string): NotificationCategory | null {
  switch (eventType) {
    case 'participation.accepted':
    case 'participation.waitlisted':
    case 'participation.applied':
    case 'participation.rejected':
    case 'participation.promoted':
    case 'participation.consent_requested':
      return 'participation';
    case 'participation.payment_pending':
    case 'payment.paid':
      return 'payment';
    case 'participation.reminder':
      return 'reminder';
    case 'event.cancelled':
      return 'event_change';
    case 'follow.created':
    case 'event.followed_published':
      return 'social';
    default:
      return null;
  }
}

/** 判定に使うユーザー項目(users 行の一部) */
export interface PrefUser {
  emailNotifications: boolean;
  discordDmNotifications: boolean;
  discordWebhookUrl: string | null;
  notificationPrefs: NotificationPrefs | null;
}

/** そのチャンネルの既定値(セル未指定時)。従来設定から導く */
function channelDefault(user: PrefUser, channel: NotificationChannel): boolean {
  switch (channel) {
    case 'email':
      return user.emailNotifications;
    case 'discordDm':
      return user.discordDmNotifications;
    case 'discordWebhook':
      // Webhook は URL を設定している時点で受け取る意思表示とみなす
      return !!user.discordWebhookUrl;
    case 'ap':
      // 連携 Fediverse への通知は明示オプトイン(既定オフ)
      return false;
  }
}

/** カテゴリ × チャンネルで受け取るか。セル指定があれば優先、なければ既定 */
export function channelEnabled(
  user: PrefUser,
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  const cell = user.notificationPrefs?.[category]?.[channel];
  return typeof cell === 'boolean' ? cell : channelDefault(user, channel);
}

/** 設定画面の初期表示用に、全セルの現在の実効値を返す */
export function effectivePrefs(user: PrefUser): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const c of NOTIFICATION_CATEGORIES) {
    for (const ch of NOTIFICATION_CHANNELS) {
      out[`${c.key}_${ch.key}`] = channelEnabled(user, c.key, ch.key);
    }
  }
  return out;
}

/** 送信フォームから種別 × チャンネルのマトリクスを組み立てる */
export function parseNotificationPrefs(has: (field: string) => boolean): NotificationPrefs {
  const prefs: NotificationPrefs = {};
  for (const c of NOTIFICATION_CATEGORIES) {
    const row: Partial<Record<NotificationChannel, boolean>> = {};
    for (const ch of NOTIFICATION_CHANNELS) {
      row[ch.key] = has(`notify_${c.key}_${ch.key}`);
    }
    prefs[c.key] = row;
  }
  return prefs;
}
