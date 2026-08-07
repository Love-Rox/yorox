import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { getDb, getGroupByHandle, listGroupEvents } from '../../../server/data';

const DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
});

export default async function GroupPage({ handle }: { handle: string }) {
  const db = await getDb();
  const result = await getGroupByHandle(db, handle);
  if (!result) return notFound();

  const { actor, group } = result;
  const events = await listGroupEvents(db, actor.id);

  return (
    <div>
      <title>{`${actor.displayName} - Yorox`}</title>
      <h1 className="display t-xl">{actor.displayName}</h1>
      <p className="meta-mono mt-1 text-sm text-neutral">@{actor.handle}</p>
      {group.descriptionMd && (
        <p className="mt-4 max-w-[65ch] whitespace-pre-wrap">{group.descriptionMd}</p>
      )}

      <p className="meta-mono mt-10 border-b-2 border-ink pb-2 text-sm text-neutral">
        イベント · {events.length}件
      </p>
      {events.length === 0 ? (
        <p className="mt-4 text-neutral">イベントはまだありません。</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id} className="event-row grid-cols-[minmax(0,1fr)]">
              <div className="min-w-0">
                <Link to={`/g/${handle}/events/${event.id}`} className="event-row__title">
                  {event.title}
                </Link>
                <div className="meta-mono mt-1 text-sm text-neutral">
                  {DATE_FMT.format(event.startsAt)}
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
