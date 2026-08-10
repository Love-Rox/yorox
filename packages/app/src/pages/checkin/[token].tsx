import { Link } from 'waku';
import { and, eq, inArray } from 'drizzle-orm';
import { LoginRequired } from '../../components/login-required';
import { schema } from '../../db/client';
import { recordAttendance } from '../../domain/participation';
import { getCurrentUser } from '../../server/current-user';
import { getDb } from '../../server/data';

/**
 * QR セルフチェックイン。
 * 会場に掲示された QR(/checkin/{token})を参加者が自分のスマホで読み、
 * ログイン済みならその場で出席が記録される。自分の出席のみ・冪等。
 */
export default async function CheckinPage({ token }: { token: string }) {
  const user = await getCurrentUser();
  if (!user) return <LoginRequired />;

  const db = await getDb();
  const event = await db.query.events.findFirst({
    where: eq(schema.events.checkinToken, token),
  });
  if (!event) {
    return (
      <Result tone="error" title="無効なチェックイン QR です">
        <p>QR が古い可能性があります。受付スタッフにお声がけください。</p>
      </Result>
    );
  }

  const group = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  const eventUrl = group?.handle ? `/g/${group.handle}/events/${event.id}` : '/';

  const slots = await db.query.slots.findMany({
    where: eq(schema.slots.eventId, event.id),
  });
  // 連携済み Fediverse アカウントで参加した分も本人としてチェックインできるよう、
  // 本人+全エイリアスの participations を対象にする
  const aliases = await db.query.actors.findMany({
    where: eq(schema.actors.claimedByActorId, user.actorId),
  });
  const identityIds = [user.actorId, ...aliases.map((a) => a.id)];
  const participation =
    slots.length > 0
      ? await db.query.participations.findFirst({
          where: and(
            inArray(
              schema.participations.slotId,
              slots.map((s) => s.id),
            ),
            inArray(schema.participations.actorId, identityIds),
            inArray(schema.participations.status, ['accepted', 'payment_pending']),
          ),
        })
      : undefined;

  if (!participation) {
    return (
      <Result tone="error" title="参加確定の申込が見つかりません">
        <p>
          「{event.title}」への参加確定済みの申込がこのアカウントにありません。
          補欠・抽選待ちの場合はチェックインできません。
        </p>
        <p className="mt-2 text-neutral">
          Misskey / Mastodon から申し込んだ場合は、プロフィール設定の
          「Fediverse アカウント連携」でそのアカウントを紐付けるとチェックインできます。
          連携しない場合は受付スタッフにお声がけください。
        </p>
        <p className="mt-2">
          <Link to={eventUrl} className="link">
            イベントページを確認する
          </Link>
        </p>
      </Result>
    );
  }

  // 中止イベントではチェックインさせない(出席記録も作らない)
  if (event.cancelledAt) {
    return (
      <Result tone="error" title="このイベントは中止されました">
        <p>「{event.title}」は中止されたため、チェックインできません。</p>
        {event.cancelReason && <p className="mt-2 text-neutral">{event.cancelReason}</p>}
        <p className="mt-2">
          <Link to={eventUrl} className="link">
            イベントページを確認する
          </Link>
        </p>
      </Result>
    );
  }

  const existing = await db.query.attendances.findFirst({
    where: eq(schema.attendances.participationId, participation.id),
  });
  const alreadyChecked = existing?.status === 'attended';
  if (!alreadyChecked) {
    await recordAttendance(db, {
      participationId: participation.id,
      status: 'attended',
      recordedByActorId: user.actorId,
    });
  }

  return (
    <Result tone="ok" title={alreadyChecked ? 'チェックイン済みです' : 'チェックイン完了!'}>
      <p className="t-md font-bold">{event.title}</p>
      <p className="mt-1">{user.displayName} さんの出席を記録しました。よいイベントを!</p>
      <p className="mt-3">
        <Link to={eventUrl} className="link">
          イベントページへ
        </Link>
      </p>
    </Result>
  );
}

function Result({
  tone,
  title,
  children,
}: {
  tone: 'ok' | 'error';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <title>{`${title} - Yorox`}</title>
      <div
        className={`border-2 p-6 ${tone === 'ok' ? 'border-accent-2' : 'border-accent'}`}
        style={{ boxShadow: 'var(--yorox-offset-shadow)' }}
      >
        <p className="t-2xl" aria-hidden>
          {tone === 'ok' ? '✓' : '✕'}
        </p>
        <h1 className="display mt-2 t-lg">{title}</h1>
        <div className="mt-3 text-sm">{children}</div>
      </div>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
