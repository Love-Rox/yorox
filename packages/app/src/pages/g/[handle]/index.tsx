import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { Markdown } from '../../../lib/markdown';
import { getCurrentUser } from '../../../server/current-user';
import { getDb, getGroupByHandle, listGroupEvents } from '../../../server/data';
import { hasGroupPermission } from '../../../server/route-auth';

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
  const user = await getCurrentUser();
  const canCreate = user
    ? await hasGroupPermission(db, actor.id, user.actorId, 'event.create')
    : false;
  const events = await listGroupEvents(db, actor.id, { includeDrafts: canCreate });

  return (
    <div>
      <title>{`${actor.displayName} - Yorox`}</title>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="display t-xl">{actor.displayName}</h1>
          <p className="meta-mono mt-1 text-sm text-neutral">@{actor.handle}</p>
        </div>
        {canCreate && (
          <Link to={`/g/${handle}/events/new`} className="btn">
            イベント作成
          </Link>
        )}
      </div>
      {group.descriptionMd && (
        <div className="mt-4">
          <Markdown source={group.descriptionMd} />
        </div>
      )}

      <p className="meta-mono mt-10 border-b-2 border-ink pb-2 text-sm text-neutral">
        イベント · {events.length}件
      </p>
      {events.length === 0 ? (
        <p className="mt-4 text-neutral">イベントはまだありません。</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id} className="border-b border-rule py-4">
              <div className="min-w-0">
                <Link to={`/g/${handle}/events/${event.id}`} className="event-row__title">
                  {event.title}
                </Link>
                {event.visibility === 'draft' && (
                  <span className="ml-2 border border-neutral px-2 py-0.5 text-sm text-neutral">
                    下書き
                  </span>
                )}
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
