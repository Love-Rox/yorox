import { eq } from 'drizzle-orm';
import { Link } from 'waku';
import {
  unstable_getRequest as getRequest,
  unstable_notFound as notFound,
} from 'waku/router/server';
import { LoginRequired } from '../../../../../../../components/login-required';
import { SlotFormFields } from '../../../../../../../components/slot-form-fields';
import { schema } from '../../../../../../../db/client';
import { getCurrentUser } from '../../../../../../../server/current-user';
import { getDb, getEventDetail } from '../../../../../../../server/data';
import { hasGroupPermission } from '../../../../../../../server/route-auth';

export default async function EditSlotPage({
  handle,
  eventId,
  slotId,
}: {
  handle: string;
  eventId: string;
  slotId: string;
}) {
  const db = await getDb();
  const user = await getCurrentUser();
  if (!user) return <LoginRequired />;

  const detail = await getEventDetail(db, eventId);
  if (!detail || detail.groupActor?.handle !== handle) return notFound();
  const canEdit = await hasGroupPermission(
    db,
    detail.event.groupActorId,
    user.actorId,
    'event.edit',
  );
  if (!canEdit) return notFound();

  const slot = detail.slots.find((s) => s.id === slotId);
  if (!slot) return notFound();

  const groupRow = await db.query.groups.findFirst({
    where: eq(schema.groups.actorId, detail.event.groupActorId),
  });

  // 申込が入っている枠では変えられない項目があるので、件数を先に見せる
  const participations = await db.query.participations.findMany({
    where: eq(schema.participations.slotId, slotId),
  });
  const live = participations.filter((p) => p.status !== 'cancelled').length;

  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');
  const eventUrl = `/g/${handle}/events/${eventId}`;

  return (
    <div className="max-w-xl">
      <title>{`枠の編集: ${slot.name} - Yorox`}</title>
      <p className="text-sm">
        <Link to={eventUrl} className="link">
          ← イベントページへ戻る
        </Link>
      </p>
      <h1 className="display mt-2 t-lg">枠の編集</h1>
      <p className="mt-1 text-sm text-neutral">
        {detail.event.title} / {slot.name}
      </p>

      {error && (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          {decodeURIComponent(error)}
        </p>
      )}

      {live > 0 && (
        <p role="status" className="mt-4 border-2 border-rule p-3 text-sm">
          この枠には申込が {live} 件あります。既存の参加者の扱いが壊れるため、
          <strong>方式(先着 / 抽選)・補欠モデル・参加費・支払方法</strong>は変更できません。
          定員は変更できます(減らしても確定済みの参加者は取り消されません)。
        </p>
      )}

      <form
        method="post"
        action={`/slots/${slot.id}/update`}
        className="mt-6 space-y-4 border-2 border-ink p-4"
      >
        <SlotFormFields
          slot={slot}
          groupDiscordGuildId={groupRow?.discordGuildId}
          stripeConnected={!!groupRow?.stripeAccountId}
        />
        <button type="submit" className="btn cursor-pointer">
          保存
        </button>
      </form>

      <section className="mt-8 border-2 border-accent p-4">
        <h2 className="display t-md text-accent">枠の削除</h2>
        {live > 0 ? (
          <p className="mt-2 text-sm">
            申込が {live} 件あるため削除できません。先に参加者の申込をキャンセルしてください。
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm">
              この枠を削除します。元に戻せません。
            </p>
            <form method="post" action={`/slots/${slot.id}/delete`} className="mt-3">
              <button type="submit" className="btn-quiet cursor-pointer text-accent">
                この枠を削除する
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
