import { Link } from 'waku';
import { getDb, listUpcomingEvents } from '../server/data';

function formatDate(d: Date, timezoneHint?: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezoneHint ?? 'Asia/Tokyo',
  }).format(d);
}

export default async function HomePage() {
  const db = await getDb();
  const upcoming = await listUpcomingEvents(db);

  return (
    <div className="w-full max-w-2xl">
      <title>Yorox</title>
      <h1 className="text-4xl font-bold tracking-tight">Yorox</h1>
      <p className="mt-2 text-gray-600">
        分散型で運用できるイベント管理プラットフォーム(開発中)
      </p>

      <h2 className="mt-8 text-2xl font-bold">今後のイベント</h2>
      {upcoming.length === 0 ? (
        <p className="mt-4 text-gray-500">公開中のイベントはまだありません。</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {upcoming.map((event) => (
            <li key={event.id} className="rounded-lg border p-4">
              <Link
                to={`/g/${event.groupHandle}/events/${event.id}`}
                className="text-lg font-semibold underline"
              >
                {event.title}
              </Link>
              <div className="mt-1 text-sm text-gray-600">
                {formatDate(event.startsAt)} ·{' '}
                <Link to={`/g/${event.groupHandle}`} className="underline">
                  {event.groupName}
                </Link>
                {event.venueName ? ` · ${event.venueName}` : event.onlineUrl ? ' · オンライン' : ''}
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
