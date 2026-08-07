import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { getDb, getGroupByHandle, listGroupEvents } from '../../../server/data';

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(d);
}

export default async function GroupPage({ handle }: { handle: string }) {
  const db = await getDb();
  const result = await getGroupByHandle(db, handle);
  if (!result) return notFound();

  const { actor, group } = result;
  const events = await listGroupEvents(db, actor.id);

  return (
    <div className="w-full max-w-2xl">
      <title>{`${actor.displayName} - Yorox`}</title>
      <h1 className="text-3xl font-bold tracking-tight">{actor.displayName}</h1>
      <div className="mt-1 text-sm text-gray-500">@{actor.handle}</div>
      {group.descriptionMd && <p className="mt-4 whitespace-pre-wrap">{group.descriptionMd}</p>}

      <h2 className="mt-8 text-2xl font-bold">イベント</h2>
      {events.length === 0 ? (
        <p className="mt-4 text-gray-500">イベントはまだありません。</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {events.map((event) => (
            <li key={event.id} className="rounded-lg border p-4">
              <Link
                to={`/g/${handle}/events/${event.id}`}
                className="text-lg font-semibold underline"
              >
                {event.title}
              </Link>
              <div className="mt-1 text-sm text-gray-600">{formatDate(event.startsAt)}</div>
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
