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
    <div className="w-full max-w-2xl">
      <title>{`${event.title} - Yorox`}</title>
      <div className="text-sm text-gray-500">
        <Link to={`/g/${handle}`} className="underline">
          {groupActor?.displayName}
        </Link>
      </div>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">{event.title}</h1>
      <div className="mt-2 text-gray-700">
        <div>{formatDate(event.startsAt, event.timezone)}</div>
        {event.endsAt && <div>〜 {formatDate(event.endsAt, event.timezone)}</div>}
        {event.venueName && (
          <div className="mt-1">
            会場: {event.venueName}
            {event.venueAddress && `(${event.venueAddress})`}
          </div>
        )}
        {event.onlineUrl && (
          <div className="mt-1">
            オンライン:{' '}
            <a href={event.onlineUrl} className="underline" rel="noreferrer">
              {event.onlineUrl}
            </a>
          </div>
        )}
      </div>

      {event.descriptionMd && (
        <section className="mt-6">
          {/* TODO: Markdown レンダリング(MVP はプレーンテキスト表示) */}
          <p className="whitespace-pre-wrap">{event.descriptionMd}</p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-2xl font-bold">参加枠</h2>
        {slots.length === 0 ? (
          <p className="mt-2 text-gray-500">参加枠は未設定です。</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {slots.map((slot) => {
              const stats = slotStats.get(slot.id);
              return (
                <li key={slot.id} className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <div className="font-semibold">{slot.name}</div>
                    <div className="text-sm text-gray-600">
                      {SLOT_METHOD_LABEL[slot.method]} · 定員 {slot.capacity} 名
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div>
                      {stats?.accepted ?? 0} / {slot.capacity}
                    </div>
                    {(stats?.waitlisted ?? 0) > 0 && (
                      <div className="text-gray-500">補欠 {stats?.waitlisted}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {sessions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-2xl font-bold">セッション</h2>
          <ul className="mt-4 space-y-3">
            {sessions.map((session) => (
              <li key={session.id} className="rounded-lg border p-4">
                <div className="font-semibold">{session.title}</div>
                {(session.speakerName || session.descriptionMd) && (
                  <div className="mt-1 text-sm text-gray-600">
                    {session.speakerName && <span>{session.speakerName}</span>}
                    {session.descriptionMd && (
                      <p className="mt-1 whitespace-pre-wrap">{session.descriptionMd}</p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {materials.length > 0 && (
        <section className="mt-8">
          <h2 className="text-2xl font-bold">資料</h2>
          <ul className="mt-4 list-inside list-disc">
            {materials.map((material) => (
              <li key={material.id}>
                <a href={material.url} className="underline" rel="noreferrer">
                  {material.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
