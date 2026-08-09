import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { ActorName } from '../../../../../components/actor-name';
import { LoginRequired } from '../../../../../components/login-required';
import { PrintButton } from '../../../../../components/print-button';
import { getCurrentUser } from '../../../../../server/current-user';
import {
  getDb,
  getEventDetail,
  listManageParticipations,
} from '../../../../../server/data';
import { hasGroupPermission } from '../../../../../server/route-auth';

const STATUS_LABEL: Record<string, string> = {
  applied: '抽選待ち',
  accepted: '参加確定',
  payment_pending: '支払い待ち',
  waitlisted: '補欠',
  consent_pending: '繰上承諾待ち',
  rejected: '落選',
  cancelled: 'キャンセル済み',
};

const DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
});

/** 受付用の印刷ページ(主催向け)。チェック欄付きの参加者名簿 */
export default async function PrintPage({
  handle,
  eventId,
}: {
  handle: string;
  eventId: string;
}) {
  const db = await getDb();
  const user = await getCurrentUser();
  if (!user) return <LoginRequired />;

  const detail = await getEventDetail(db, eventId);
  if (!detail || detail.groupActor?.handle !== handle) return notFound();
  const allowed =
    (await hasGroupPermission(db, detail.event.groupActorId, user.actorId, 'attendance.manage')) ||
    (await hasGroupPermission(db, detail.event.groupActorId, user.actorId, 'event.edit'));
  if (!allowed) return notFound();

  const { event, slots } = detail;
  const { rows } = await listManageParticipations(db, eventId);

  return (
    <div className="print-sheet">
      <title>{`受付名簿: ${event.title} - Yorox`}</title>
      <div className="no-print mb-6 flex flex-wrap items-center gap-3">
        <PrintButton />
        <Link to={`/g/${handle}/events/${eventId}/manage`} className="link text-sm">
          ← 管理コンソールへ戻る
        </Link>
      </div>

      <h1 className="display t-lg">{event.title} — 受付名簿</h1>
      <p className="meta-mono mt-1 text-sm text-neutral">
        {DATE_FMT.format(event.startsAt)}
        {event.venueName && ` · ${event.venueName}`}
      </p>

      {slots.map((slot) => {
        const slotRows = rows.filter((r) => r.slotId === slot.id && r.status !== 'cancelled');
        if (slotRows.length === 0) return null;
        return (
          <section key={slot.id} className="mt-6 break-inside-avoid">
            <h2 className="display border-b-2 border-ink pb-1 t-md">
              {slot.name}
              <span className="meta-mono ml-3 text-sm font-normal text-neutral">
                {slotRows.length}名
              </span>
            </h2>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink text-left">
                  <th className="w-10 py-1.5">出席</th>
                  <th className="py-1.5">名前</th>
                  <th className="py-1.5">ハンドル</th>
                  <th className="py-1.5">状態</th>
                </tr>
              </thead>
              <tbody>
                {slotRows.map((r) => (
                  <tr key={r.id} className="border-b border-rule">
                    <td className="py-2">
                      <span
                        aria-hidden
                        className="inline-block size-4 border-2 border-ink align-middle"
                      />
                    </td>
                    <td className="py-2 font-bold">
                      <ActorName name={r.displayName} emojis={r.emojis} />
                    </td>
                    <td className="meta-mono py-2 text-neutral">
                      {r.handle ? (r.domain ? `@${r.handle}@${r.domain}` : `@${r.handle}`) : ''}
                    </td>
                    <td className="py-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
