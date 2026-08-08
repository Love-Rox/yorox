import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { Markdown } from '../../../lib/markdown';
import { getCurrentUser } from '../../../server/current-user';
import {
  getDb,
  getGroupByHandle,
  listGroupEvents,
  listOrganizers,
} from '../../../server/data';
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
  const canSettings = user
    ? (await hasGroupPermission(db, actor.id, user.actorId, 'group.settings')) ||
      (await hasGroupPermission(db, actor.id, user.actorId, 'member.manage'))
    : false;
  const events = await listGroupEvents(db, actor.id, { includeDrafts: canCreate });
  const organizers = await listOrganizers(db, actor.id);

  return (
    <div>
      <title>{`${actor.displayName} - Yorox`}</title>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="display t-xl">{actor.displayName}</h1>
          <p className="meta-mono mt-1 text-sm text-neutral">@{actor.handle}</p>
        </div>
        <span className="flex gap-3">
          {canSettings && (
            <Link to={`/g/${handle}/settings`} className="btn-quiet">
              設定
            </Link>
          )}
          {canCreate && (
            <Link to={`/g/${handle}/events/new`} className="btn">
              イベント作成
            </Link>
          )}
        </span>
      </div>
      {group.descriptionMd && (
        <div className="mt-4">
          <Markdown source={group.descriptionMd} />
        </div>
      )}

      {organizers.length > 0 && (
        <section className="mt-6">
          <h2 className="meta-mono text-sm text-neutral">運営メンバー</h2>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {organizers.map((o) => (
              <li key={o.actorId}>
                {o.handle && o.handle !== actor.handle ? (
                  <Link to={`/g/${o.handle}`} className="link font-bold">
                    {o.displayName}
                  </Link>
                ) : (
                  <span className="font-bold">{o.displayName}</span>
                )}
                <span className="meta-mono ml-1 text-sm text-neutral">({o.roleName})</span>
              </li>
            ))}
          </ul>
        </section>
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
