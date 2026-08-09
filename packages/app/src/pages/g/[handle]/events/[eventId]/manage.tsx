import { Link } from 'waku';
import {
  unstable_getRequest as getRequest,
  unstable_notFound as notFound,
} from 'waku/router/server';
import { LoginRequired } from '../../../../../components/login-required';
import { ManageParticipants } from '../../../../../components/manage-participants';
import { getCurrentUser } from '../../../../../server/current-user';
import {
  getDb,
  getEventDetail,
  listManageParticipations,
} from '../../../../../server/data';
import { hasGroupPermission } from '../../../../../server/route-auth';
import { renderSVG } from 'uqr';

export default async function ManagePage({
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

  const canEdit = await hasGroupPermission(
    db,
    detail.event.groupActorId,
    user.actorId,
    'event.edit',
  );
  const canAttendance = await hasGroupPermission(
    db,
    detail.event.groupActorId,
    user.actorId,
    'attendance.manage',
  );
  const canLottery = await hasGroupPermission(
    db,
    detail.event.groupActorId,
    user.actorId,
    'lottery.run',
  );
  if (!canEdit && !canAttendance && !canLottery) return notFound();

  const { event, slots, sessions, materials } = detail;
  const { rows, history } = await listManageParticipations(db, eventId);

  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');
  const messageSent = url.searchParams.get('message_sent');

  return (
    <div>
      <title>{`管理: ${event.title} - Yorox`}</title>
      <p className="text-sm">
        <Link to={`/g/${handle}/events/${eventId}`} className="link">
          ← イベントページへ戻る
        </Link>
      </p>
      <h1 className="display mt-2 t-lg">管理: {event.title}</h1>
      {event.visibility === 'draft' && (
        <p className="meta-mono mt-1 text-sm text-neutral">下書き(未公開)</p>
      )}

      {error && (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          {decodeURIComponent(error)}
        </p>
      )}
      {messageSent && (
        <p role="status" className="mt-4 border-2 border-accent-2 p-3 text-sm text-accent-2">
          {messageSent}名にメッセージを送信しました(メールは数分以内に配送されます)。
        </p>
      )}

      {/* ---- エクスポート ---- */}
      <section className="mt-8 flex flex-wrap items-center gap-3 border-2 border-ink p-4">
        <h2 className="display t-md">参加者のエクスポート</h2>
        <span className="flex flex-wrap gap-3 text-sm">
          <Link to={`/g/${handle}/events/${eventId}/print`} className="btn-quiet">
            印刷用の受付名簿
          </Link>
          <a href={`/events/${eventId}/participants.csv`} className="btn-quiet">
            CSV(絵文字コードあり)
          </a>
          <a href={`/events/${eventId}/participants.csv?emoji=strip`} className="btn-quiet">
            CSV(絵文字コードなし)
          </a>
        </span>
      </section>

      {/* ---- QR チェックイン ---- */}
      {canAttendance && (
        <section className="mt-8 border-2 border-ink p-4">
          <h2 className="display t-md">QR チェックイン</h2>
          {event.checkinToken ? (
            (() => {
              const checkinUrl = `${url.origin}/checkin/${event.checkinToken}`;
              return (
                <div className="mt-3">
                  <p className="text-sm text-neutral">
                    この QR を受付に掲示すると、参加者が自分のスマホで読み取って
                    セルフチェックイン(出席記録)できます。ログイン済みで参加確定の
                    本人のみ記録されます。
                  </p>
                  <div
                    className="mt-3 w-full max-w-60 border border-rule bg-white p-2 [&_svg]:h-auto [&_svg]:w-full"
                    // uqr が生成する QR SVG のみを埋め込む
                    dangerouslySetInnerHTML={{ __html: renderSVG(checkinUrl) }}
                  />
                  <p className="meta-mono mt-2 text-sm break-all text-neutral">{checkinUrl}</p>
                  <form
                    method="post"
                    action={`/events/${event.id}/checkin/enable`}
                    className="mt-3"
                  >
                    <button type="submit" className="btn-quiet cursor-pointer text-sm">
                      QR を再発行(旧 QR は無効化)
                    </button>
                  </form>
                </div>
              );
            })()
          ) : (
            <div className="mt-3">
              <p className="text-sm text-neutral">
                受付に掲示する QR を発行すると、参加者がスキャンだけで出席記録できます。
              </p>
              <form method="post" action={`/events/${event.id}/checkin/enable`} className="mt-3">
                <button type="submit" className="btn cursor-pointer">
                  チェックイン QR を発行
                </button>
              </form>
            </div>
          )}
        </section>
      )}

      {/* ---- 枠ごとの参加者管理(検索付き・クライアント絞り込み) ---- */}
      <ManageParticipants
        eventId={eventId}
        slots={slots.map((s) => ({
          id: s.id,
          name: s.name,
          method: s.method,
          lotteryLogic: s.lotteryLogic,
          capacity: s.capacity,
        }))}
        rows={rows.map((r) => ({
          id: r.id,
          slotId: r.slotId,
          status: r.status,
          actorId: r.actorId,
          displayName: r.displayName,
          handle: r.handle,
          domain: r.domain,
          avatarUrl: r.avatarUrl,
          emojis: r.emojis,
          attendanceStatus: r.attendanceStatus,
          paymentId: r.paymentId,
          paymentStatus: r.paymentStatus,
          paymentAmount: r.paymentAmount,
        }))}
        history={Object.fromEntries(history)}
        canLottery={canLottery}
        canAttendance={canAttendance}
      />

      {/* ---- セッション管理 ---- */}
      {canEdit && (
        <section className="mt-12">
          <h2 className="display border-b-2 border-ink pb-2 t-md">セッション</h2>
          {sessions.length > 0 && (
            <ul className="mt-2">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 border-b border-rule py-3"
                >
                  <div className="min-w-0">
                    {s.startsAt && (
                      <span className="meta-mono mr-2 text-sm text-neutral">
                        {new Intl.DateTimeFormat('ja-JP', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Tokyo',
                        }).format(s.startsAt)}
                        {s.endsAt &&
                          `–${new Intl.DateTimeFormat('ja-JP', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Tokyo',
                          }).format(s.endsAt)}`}
                      </span>
                    )}
                    <span className="font-bold">{s.title}</span>
                    {s.speakerName && (
                      <span className="ml-2 text-sm text-neutral">{s.speakerName}</span>
                    )}
                  </div>
                  <form method="post" action={`/sessions/${s.id}/delete`}>
                    <button
                      type="submit"
                      className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-accent"
                    >
                      削除
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-4 border-2 border-ink">
            <summary className="cursor-pointer p-3 font-bold">セッションを追加</summary>
            <form
              method="post"
              action={`/events/${event.id}/sessions`}
              className="space-y-4 border-t-2 border-ink p-4"
            >
              <label className="block">
                <span className="text-sm font-bold">タイトル *</span>
                <input type="text" name="title" required maxLength={200} className="input mt-1" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold">登壇者名</span>
                  <input type="text" name="speaker_name" maxLength={100} className="input mt-1" />
                </label>
                <label className="block">
                  <span className="text-sm font-bold">登壇者リンク(SNS・サイト)</span>
                  <input
                    type="url"
                    name="speaker_url"
                    className="input meta-mono mt-1"
                    placeholder="https://x.com/…"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-sm font-bold">概要</span>
                <textarea name="description_md" rows={3} className="input mt-1" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold">開始時刻</span>
                  <input type="datetime-local" name="starts_at" className="input meta-mono mt-1" />
                </label>
                <label className="block">
                  <span className="text-sm font-bold">終了時刻</span>
                  <input type="datetime-local" name="ends_at" className="input meta-mono mt-1" />
                </label>
              </div>
              <button type="submit" className="btn cursor-pointer">
                追加
              </button>
            </form>
          </details>
        </section>
      )}

      {/* ---- 資料管理 ---- */}
      {canEdit && (
        <section className="mt-12">
          <h2 className="display border-b-2 border-ink pb-2 t-md">資料</h2>
          {materials.length > 0 && (
            <ul className="mt-2">
              {materials.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 border-b border-rule py-3"
                >
                  <a href={m.url} className="link min-w-0" rel="noreferrer">
                    {m.title}
                  </a>
                  <form method="post" action={`/materials/${m.id}/delete`}>
                    <button
                      type="submit"
                      className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-accent"
                    >
                      削除
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-4 border-2 border-ink">
            <summary className="cursor-pointer p-3 font-bold">資料を追加(外部リンク)</summary>
            <form
              method="post"
              action={`/events/${event.id}/materials`}
              className="space-y-4 border-t-2 border-ink p-4"
            >
              <label className="block">
                <span className="text-sm font-bold">タイトル *</span>
                <input type="text" name="title" required maxLength={200} className="input mt-1" />
              </label>
              <label className="block">
                <span className="text-sm font-bold">URL *</span>
                <input
                  type="url"
                  name="url"
                  required
                  className="input meta-mono mt-1"
                  placeholder="https://speakerdeck.com/…"
                />
              </label>
              {sessions.length > 0 && (
                <label className="block">
                  <span className="text-sm font-bold">紐付け先セッション(任意)</span>
                  <select name="session_id" className="input mt-1">
                    <option value="">イベント直下</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="submit" className="btn cursor-pointer">
                追加
              </button>
            </form>
          </details>
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
