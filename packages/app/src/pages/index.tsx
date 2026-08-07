import { Link } from 'waku';
import { getDb, listUpcomingEvents } from '../server/data';

const DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Tokyo',
});
const TIME_FMT = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tokyo',
});
const WEEKDAY_FMT = new Intl.DateTimeFormat('ja-JP', {
  weekday: 'short',
  timeZone: 'Asia/Tokyo',
});

export default async function HomePage() {
  const db = await getDb();
  const upcoming = await listUpcomingEvents(db);

  return (
    <div>
      <title>Yorox</title>

      {/* Index-First: 導入は一行、以降はリストが主役 */}
      <p className="meta-mono text-sm text-neutral">
        今後のイベント · {upcoming.length}件
      </p>

      {upcoming.length === 0 ? (
        <p className="mt-6 text-neutral">
          公開中のイベントはまだありません。グループを作って最初のイベントを立てましょう。
        </p>
      ) : (
        <ul className="mt-4">
          {upcoming.map((event) => (
            <li key={event.id} className="event-row">
              <div className="meta-mono">
                <span className="display block t-md leading-none">
                  {DATE_FMT.format(event.startsAt)}
                </span>
                <span className="mt-1 block text-sm text-neutral">
                  {WEEKDAY_FMT.format(event.startsAt)} {TIME_FMT.format(event.startsAt)}
                </span>
              </div>
              <div className="min-w-0">
                <Link
                  to={`/g/${event.groupHandle}/events/${event.id}`}
                  className="event-row__title"
                >
                  {event.title}
                </Link>
                <div className="mt-1 text-sm text-neutral">
                  <Link to={`/g/${event.groupHandle}`} className="link">
                    {event.groupName}
                  </Link>
                  {event.venueName
                    ? ` · ${event.venueName}`
                    : event.onlineUrl
                      ? ' · オンライン'
                      : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
