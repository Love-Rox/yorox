import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { Avatar } from '../../../../../components/avatar';
import { getCurrentUser } from '../../../../../server/current-user';
import {
  getDb,
  getEventDetail,
  listVisibleParticipants,
} from '../../../../../server/data';
import { hasGroupPermission } from '../../../../../server/route-auth';

/** 参加者一覧ページ(イベントページはアイコンのみ、詳細はこちら) */
export default async function ParticipantsPage({
  handle,
  eventId,
}: {
  handle: string;
  eventId: string;
}) {
  const db = await getDb();
  const detail = await getEventDetail(db, eventId);
  if (!detail || detail.groupActor?.handle !== handle) return notFound();

  const { event, slots } = detail;
  const user = await getCurrentUser();
  const canEdit = user
    ? await hasGroupPermission(db, event.groupActorId, user.actorId, 'event.edit')
    : false;
  if (event.visibility !== 'public' && !canEdit) return notFound();
  if (!event.participantListPublic) return notFound();

  const participants = await listVisibleParticipants(db, eventId);

  return (
    <div>
      <title>{`参加者: ${event.title} - Yorox`}</title>
      <p className="text-sm">
        <Link to={`/g/${handle}/events/${eventId}`} className="link">
          ← イベントページへ戻る
        </Link>
      </p>
      <h1 className="display mt-2 t-lg">参加者</h1>
      <p className="mt-1 text-sm text-neutral">
        {event.title} · {participants.length}名
      </p>

      {slots.map((slot) => {
        const slotParticipants = participants.filter((p) => p.slotId === slot.id);
        if (slotParticipants.length === 0) return null;
        return (
          <section key={slot.id} className="mt-8">
            <h2 className="display border-b-2 border-ink pb-2 t-md">
              {slot.name}
              <span className="meta-mono ml-3 text-sm font-normal text-neutral">
                {slotParticipants.length}名
              </span>
            </h2>
            <ul className="mt-2">
              {slotParticipants.map((p) => (
                <li
                  key={`${p.slotId}-${p.actorId}`}
                  className="flex items-center gap-3 border-b border-rule py-3"
                >
                  <Avatar avatarUrl={p.avatarUrl} displayName={p.displayName} />
                  {p.domain ? (
                    <a href={p.uri} className="link font-bold" rel="noreferrer" target="_blank">
                      {p.displayName}
                      <span className="meta-mono ml-2 text-sm font-normal text-neutral">
                        @{p.handle}@{p.domain}
                      </span>
                    </a>
                  ) : p.handle ? (
                    <Link to={`/u/${p.handle}`} className="link font-bold">
                      {p.displayName}
                      <span className="meta-mono ml-2 text-sm font-normal text-neutral">
                        @{p.handle}
                      </span>
                    </Link>
                  ) : (
                    <span className="font-bold">{p.displayName}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
