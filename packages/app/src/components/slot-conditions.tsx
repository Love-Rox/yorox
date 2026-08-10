/**
 * 枠の参加条件を申込前に見せる。
 * 申し込んでから理由付きで断られるより、条件を先に示すほうが親切なので、
 * イベントページの枠一覧に並べる。
 */
import type { SlotConditions } from '../db/schema';

/** 条件を人間可読の短い文にする(空配列 = 誰でも申し込める) */
export function describeSlotConditions(conditions: SlotConditions | null | undefined): string[] {
  if (!conditions) return [];
  const items: string[] = [];
  if (conditions.requireClaimed) items.push('アカウント連携済みの人のみ');
  if (conditions.minAccountAgeDays !== undefined && conditions.minAccountAgeDays > 0) {
    items.push(`アカウント作成から${conditions.minAccountAgeDays}日以上`);
  }
  if (conditions.minAttendedCount !== undefined && conditions.minAttendedCount > 0) {
    items.push(`参加実績${conditions.minAttendedCount}回以上`);
  }
  if (conditions.requireDiscordGuild) {
    items.push('指定の Discord サーバーの参加者のみ');
  }
  return items;
}

export function SlotConditionBadges({
  conditions,
}: {
  conditions: SlotConditions | null | undefined;
}) {
  const items = describeSlotConditions(conditions);
  if (items.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {items.map((label) => (
        <span
          key={label}
          className="inline-block border border-rule px-1.5 py-0.5 text-sm text-neutral"
        >
          参加条件: {label}
        </span>
      ))}
    </div>
  );
}
