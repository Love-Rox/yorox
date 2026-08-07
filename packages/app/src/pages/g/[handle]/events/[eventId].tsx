import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { getDb, getEventDetail } from '../../../../server/data';

function formatDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(d);
}

const SLOT_METHOD_LABEL = { fcfs: '先着', lottery: '抽選' } as const;

export default async function EventPage({
  handle,
  eventId,
}: {
  handle: string;
  eventId: string;
}) {
  const db = await getDb();
  const detail = await getEventDetail(db, eventId);
  if (!detail || detail.event.visibility !== 'public') return notFound();
  if (detail.groupActor?.handle !== handle) return notFound();

  const { event, groupActor, slots, slotStats, sessions, materials } = detail;

  return (
    <article>
      <title>{`${event.title} - Yorox`}</title>
      <p className="text-sm">
        <Link to={`/g/${handle}`} className="link">
          {groupActor?.displayName}
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">{event.title}</h1>
      <div className="meta-mono mt-3 text-sm leading-6 text-neutral">
        <div>{formatDate(event.startsAt, event.timezone)}</div>
        {event.endsAt && <div>〜 {formatDate(event.endsAt, event.timezone)}</div>}
        {event.venueName && (
          <div>
            会場: {event.venueName}
            {event.venueAddress && `(${event.venueAddress})`}
          </div>
        )}
        {event.onlineUrl && (
          <div>
            オンライン:{' '}
            <a href={event.onlineUrl} className="link" rel="noreferrer">
              {event.onlineUrl}
            </a>
          </div>
        )}
      </div>

      {event.descriptionMd && (
        <section className="mt-8 max-w-[65ch]">
          {/* TODO: Markdown レンダリング(MVP はプレーンテキスト表示) */}
          <p className="whitespace-pre-wrap">{event.descriptionMd}</p>
        </section>
      )}

      <section className="mt-10">
        <h2 className="display border-b-2 border-ink pb-2 t-md">
          参加枠
        </h2>
        {slots.length === 0 ? (
          <p className="mt-3 text-neutral">参加枠は未設定です。</p>
        ) : (
          <ul>
            {slots.map((slot) => {
              const stats = slotStats.get(slot.id);
              return (
                <li
                  key={slot.id}
                  className="flex items-center justify-between gap-4 border-b border-rule py-4"
                >
                  <div className="min-w-0">
                    <div className="font-bold">{slot.name}</div>
                    <div className="mt-0.5 text-sm text-neutral">
                      {SLOT_METHOD_LABEL[slot.method]} · 定員 {slot.capacity} 名
                    </div>
                  </div>
                  <div className="meta-mono shrink-0 text-right text-sm">
                    <div className="t-md font-bold">
                      {stats?.accepted ?? 0}
                      <span className="text-sm font-normal text-neutral">
                        {' '}
                        / {slot.capacity}
                      </span>
                    </div>
                    {(stats?.waitlisted ?? 0) > 0 && (
                      <div className="text-neutral">補欠 {stats?.waitlisted}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {sessions.length > 0 && (
        <section className="mt-10">
          <h2 className="display border-b-2 border-ink pb-2 t-md">
            セッション
          </h2>
          <ul>
            {sessions.map((session) => (
              <li key={session.id} className="border-b border-rule py-4">
                <div className="font-bold">{session.title}</div>
                {session.speakerName && (
                  <div className="mt-0.5 text-sm text-neutral">{session.speakerName}</div>
                )}
                {session.descriptionMd && (
                  <p className="mt-2 max-w-[65ch] whitespace-pre-wrap text-sm">
                    {session.descriptionMd}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {materials.length > 0 && (
        <section className="mt-10">
          <h2 className="display border-b-2 border-ink pb-2 t-md">
            資料
          </h2>
          <ul className="mt-3 space-y-2">
            {materials.map((material) => (
              <li key={material.id}>
                <a href={material.url} className="link" rel="noreferrer">
                  {material.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
