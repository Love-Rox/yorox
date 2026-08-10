/**
 * 通知本文の組み立て。
 *
 * テンプレートの一文だけでは「どのイベントの話か」が分からず、
 * 受け取った人が判断できない。イベント名・日時・会場・枠名と URL を必ず添える。
 */

export interface NotificationContext {
  eventTitle: string;
  startsAt: Date;
  endsAt?: Date | null | undefined;
  venue?: string | null | undefined;
  slotName?: string | null | undefined;
  /** イベントの絶対 URL(短縮 URL /e/:id を使う) */
  url: string;
}

const TZ = 'Asia/Tokyo';
const DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  timeZone: TZ,
});
const TIME_FMT = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TZ,
});
const DAY_KEY_FMT = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TZ,
});

/** 「2026年8月13日(木) 19:00〜21:00」。日をまたぐときは終了側も日付を出す */
export function formatEventPeriod(startsAt: Date, endsAt?: Date | null): string {
  const head = `${DATE_FMT.format(startsAt)} ${TIME_FMT.format(startsAt)}`;
  if (!endsAt) return head;
  const sameDay = DAY_KEY_FMT.format(startsAt) === DAY_KEY_FMT.format(endsAt);
  return sameDay
    ? `${head}〜${TIME_FMT.format(endsAt)}`
    : `${head}〜${DATE_FMT.format(endsAt)} ${TIME_FMT.format(endsAt)}`;
}

/**
 * テンプレート本文にイベントの詳細を足す。
 * ctx が無い(枠を解決できなかった)場合はテンプレートだけを返す。
 */
export function buildNotificationBody(
  templateBody: string,
  ctx: NotificationContext | null,
): string {
  if (!ctx) return templateBody;

  const lines = [
    templateBody,
    '',
    `■ イベント: ${ctx.eventTitle}`,
    `■ 日時: ${formatEventPeriod(ctx.startsAt, ctx.endsAt)}`,
  ];
  if (ctx.venue) lines.push(`■ 会場: ${ctx.venue}`);
  if (ctx.slotName) lines.push(`■ 参加枠: ${ctx.slotName}`);
  lines.push('', ctx.url);
  return lines.join('\n');
}
