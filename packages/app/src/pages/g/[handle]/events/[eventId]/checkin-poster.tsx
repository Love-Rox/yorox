import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { unstable_getRequest as getRequest } from 'waku/router/server';
import { and, eq, isNull } from 'drizzle-orm';
import { renderSVG } from 'uqr';
import { Avatar } from '../../../../../components/avatar';
import { LoginRequired } from '../../../../../components/login-required';
import { PrintButton } from '../../../../../components/print-button';
import { schema } from '../../../../../db/client';
import { getCurrentUser } from '../../../../../server/current-user';
import { getDb, getEventDetail } from '../../../../../server/data';
import { hasGroupPermission } from '../../../../../server/route-auth';

const DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
});

/**
 * チェックイン QR の掲示用ポスター(A4 想定)。
 * ブラウザの印刷から紙にも PDF にも出せる。
 */
export default async function CheckinPosterPage({
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
  const allowed = await hasGroupPermission(
    db,
    detail.event.groupActorId,
    user.actorId,
    'attendance.manage',
  );
  if (!allowed) return notFound();

  const { event, groupActor } = detail;
  if (!event.checkinToken) {
    return (
      <div className="max-w-md py-10">
        <p>
          チェックイン QR が未発行です。
          <Link to={`/g/${handle}/events/${eventId}/manage`} className="link">
            管理コンソール
          </Link>
          で発行してください。
        </p>
      </div>
    );
  }

  // 個人グループはオーナーのアバターにフォールバック(QR 中央アイコン)
  let groupAvatarUrl = groupActor?.avatarUrl ?? null;
  if (!groupAvatarUrl && groupActor?.handle) {
    const groupRow = await db.query.groups.findFirst({
      where: eq(schema.groups.actorId, groupActor.id),
    });
    if (groupRow?.isPersonal) {
      const owner = await db.query.actors.findFirst({
        where: and(
          eq(schema.actors.handle, groupActor.handle),
          isNull(schema.actors.domain),
          eq(schema.actors.kind, 'user'),
        ),
      });
      groupAvatarUrl = owner?.avatarUrl ?? null;
    }
  }

  const url = new URL(getRequest().url);
  const checkinUrl = `${url.origin}/checkin/${event.checkinToken}`;

  return (
    <div className="print-sheet mx-auto max-w-lg">
      <title>{`チェックイン QR: ${event.title} - Yorox`}</title>
      <div className="no-print mb-6 flex flex-wrap items-center gap-3">
        <PrintButton />
        <Link to={`/g/${handle}/events/${eventId}/manage`} className="link text-sm">
          ← 管理コンソールへ戻る
        </Link>
        <p className="w-full text-sm text-neutral">
          印刷ダイアログで「PDF に保存」を選ぶと PDF としても保存できます。
        </p>
      </div>

      <div className="border-4 border-ink p-8 text-center">
        <p className="meta-mono text-sm text-neutral">{groupActor?.displayName}</p>
        <h1 className="display mt-1 t-lg">{event.title}</h1>
        <p className="meta-mono mt-1 text-sm text-neutral">
          {DATE_FMT.format(event.startsAt)}
        </p>

        <p className="display mt-6 t-md">チェックイン</p>
        <p className="mt-1 text-sm">
          お手持ちのスマホで QR を読み取ると、その場で出席受付が完了します
        </p>

        <div className="relative mx-auto mt-4 w-full max-w-80">
          <div
            className="border border-rule bg-white p-3 [&_svg]:h-auto [&_svg]:w-full"
            // uqr が生成する QR SVG のみを埋め込む(ロゴ重畳に耐える誤り訂正 H)
            dangerouslySetInnerHTML={{ __html: renderSVG(checkinUrl, { ecc: 'H' }) }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <span className="rounded-full border border-rule bg-white p-1.5">
              <Avatar
                avatarUrl={groupAvatarUrl}
                displayName={groupActor?.displayName ?? ''}
                size="lg"
              />
            </span>
          </span>
        </div>

        <p className="mx-auto mt-6 max-w-80 border-2 border-ink p-3 font-bold">
          Yorox アカウントをお持ちでない方は個別受付します
        </p>
        <p className="meta-mono mt-4 text-xs break-all text-neutral">{checkinUrl}</p>
      </div>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
