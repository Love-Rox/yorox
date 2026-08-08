import { Link } from 'waku';
import { unstable_redirect as redirect } from 'waku/router/server';
import { and, eq } from 'drizzle-orm';
import { schema } from '../db/client';
import { getCurrentUser } from '../server/current-user';
import { getDb } from '../server/data';

const DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
});

export default async function RequestsPage() {
  const db = await getDb();
  const user = await getCurrentUser();
  if (!user) return redirect('/login');

  const pending = await db.query.actionRequests.findMany({
    where: and(
      eq(schema.actionRequests.actorId, user.actorId),
      eq(schema.actionRequests.status, 'pending'),
    ),
    orderBy: [schema.actionRequests.createdAt],
  });

  // 表示用にイベント情報を解決する
  const items = [];
  for (const request of pending) {
    const participationId = (request.payload as { participationId?: string }).participationId;
    if (!participationId) continue;
    const participation = await db.query.participations.findFirst({
      where: eq(schema.participations.id, participationId),
    });
    const slot = participation
      ? await db.query.slots.findFirst({ where: eq(schema.slots.id, participation.slotId) })
      : null;
    const event = slot
      ? await db.query.events.findFirst({ where: eq(schema.events.id, slot.eventId) })
      : null;
    const groupActor = event
      ? await db.query.actors.findFirst({ where: eq(schema.actors.id, event.groupActorId) })
      : null;
    items.push({ request, slot, event, groupHandle: groupActor?.handle ?? null });
  }

  return (
    <div>
      <title>要確認 - Yorox</title>
      <h1 className="display t-xl">要確認</h1>
      <p className="mt-2 text-sm text-neutral">
        あなたの応答が必要な項目です。応答がない場合、期限後に次の方へ繰り上がります。
      </p>

      {items.length === 0 ? (
        <p className="mt-6 text-neutral">確認が必要な項目はありません。</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {items.map(({ request, slot, event, groupHandle }) => (
            <li key={request.id} className="border-2 border-ink p-4">
              <div className="font-bold">補欠から繰り上がれます</div>
              <div className="mt-1 text-sm text-neutral">
                {event && groupHandle ? (
                  <>
                    <Link to={`/g/${groupHandle}/events/${event.id}`} className="link">
                      {event.title}
                    </Link>
                    {slot && <> · {slot.name}</>}
                    <span className="meta-mono">
                      {' '}
                      · {DATE_FMT.format(event.startsAt)}
                    </span>
                  </>
                ) : (
                  '(イベント情報を取得できませんでした)'
                )}
              </div>
              <div className="mt-3 flex gap-3">
                <form method="post" action={`/action-requests/${request.id}/respond`}>
                  <input type="hidden" name="accept" value="1" />
                  <button type="submit" className="btn cursor-pointer">
                    参加する
                  </button>
                </form>
                <form method="post" action={`/action-requests/${request.id}/respond`}>
                  <input type="hidden" name="accept" value="0" />
                  <button type="submit" className="btn-quiet cursor-pointer">
                    辞退する
                  </button>
                </form>
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
