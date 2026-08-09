/**
 * iCalendar(RFC 5545)の最小生成。ゼロ依存。
 * 日時は UTC(Z 付き)で出力する。
 */

export interface IcsEvent {
  /** 安定した一意 ID(例: event-{ulid}@host)。再配信で同一予定として扱われる */
  uid: string;
  title: string;
  start: Date;
  end?: Date | null;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  /** 最終更新(なければ start を使う) */
  updated?: Date | null;
}

/** RFC5545 のテキストエスケープ(バックスラッシュ・カンマ・セミコロン・改行) */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** UTC の basic 形式(YYYYMMDDTHHMMSSZ) */
function formatUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** 75 オクテット折り返し(継続行は先頭 1 スペース) */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) parts.push(' ' + rest);
  return parts.join('\r\n');
}

function eventBlock(e: IcsEvent, stamp: Date): string {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${formatUtc(stamp)}`,
    `DTSTART:${formatUtc(e.start)}`,
    ...(e.end ? [`DTEND:${formatUtc(e.end)}`] : []),
    `SUMMARY:${escapeText(e.title)}`,
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    `LAST-MODIFIED:${formatUtc(e.updated ?? e.start)}`,
    'END:VEVENT',
  ];
  return lines.map(foldLine).join('\r\n');
}

/** VCALENDAR ドキュメントを組み立てる */
export function buildIcs(events: IcsEvent[], calendarName: string, stamp: Date): string {
  const head = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Yorox//Calendar//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine(`X-WR-CALNAME:${escapeText(calendarName)}`),
    'X-WR-TIMEZONE:Asia/Tokyo',
  ].join('\r\n');
  const body = events.map((e) => eventBlock(e, stamp)).join('\r\n');
  return [head, body, 'END:VCALENDAR'].filter(Boolean).join('\r\n') + '\r\n';
}

/** Google カレンダー「予定を追加」リンク */
export function googleCalendarUrl(e: {
  title: string;
  start: Date;
  end?: Date | null;
  location?: string | null;
  details?: string | null;
}): string {
  const end = e.end ?? new Date(e.start.getTime() + 2 * 60 * 60 * 1000); // 既定2時間
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${formatUtc(e.start)}/${formatUtc(end)}`,
  });
  if (e.location) params.set('location', e.location);
  if (e.details) params.set('details', e.details);
  return `https://calendar.google.com/calendar/render?${params}`;
}
