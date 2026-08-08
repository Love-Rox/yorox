import { Link } from 'waku';
import {
  unstable_getRequest as getRequest,
  unstable_notFound as notFound,
} from 'waku/router/server';
import { LoginRequired } from '../../../../../components/login-required';
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

const PAYMENT_LABEL: Record<string, string> = {
  pending: '未払い',
  paid: '支払済み',
  refund_required: '要返金',
  refunded: '返金済み',
  waived: '免除',
};

const YEN = new Intl.NumberFormat('ja-JP');

const SLOT_METHOD_LABEL = { fcfs: '先着', lottery: '抽選' } as const;
const LOTTERY_LABEL: Record<string, string> = {
  random: '完全ランダム',
  weighted: '出欠率重み付け',
  manual: '手動選定',
};

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

      {/* ---- 枠ごとの参加者管理 ---- */}
      {slots.map((slot) => {
        const slotRows = rows.filter((r) => r.slotId === slot.id);
        const appliedCount = slotRows.filter((r) => r.status === 'applied').length;
        return (
          <section key={slot.id} className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink pb-2">
              <h2 className="display t-md">{slot.name}</h2>
              <div className="meta-mono text-sm text-neutral">
                {SLOT_METHOD_LABEL[slot.method]}
                {slot.lotteryLogic && ` · ${LOTTERY_LABEL[slot.lotteryLogic]}`} · 定員{' '}
                {slot.capacity}
              </div>
            </div>

            {canLottery &&
              slot.method === 'lottery' &&
              slot.lotteryLogic !== 'manual' &&
              appliedCount > 0 && (
                <form method="post" action={`/slots/${slot.id}/lottery/run`} className="mt-4">
                  <button type="submit" className="btn cursor-pointer">
                    抽選を実行({appliedCount}名 → 当選{' '}
                    {Math.min(appliedCount, slot.capacity)}名)
                  </button>
                </form>
              )}

            {slotRows.length === 0 ? (
              <p className="mt-3 text-sm text-neutral">申込はまだありません。</p>
            ) : (
              <ul className="mt-2">
                {slotRows.map((p) => {
                  const h = history.get(p.actorId) ?? { attended: 0, noShow: 0 };
                  const total = h.attended + h.noShow;
                  return (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-rule py-3"
                    >
                      <div className="min-w-0">
                        <span className="font-bold">{p.displayName}</span>
                        {p.handle && (
                          <span className="meta-mono ml-2 text-sm text-neutral">
                            @{p.handle}
                            {p.domain && `@${p.domain}`}
                          </span>
                        )}
                        <div className="meta-mono mt-0.5 text-sm text-neutral">
                          {STATUS_LABEL[p.status] ?? p.status}
                          {' · 過去実績 '}
                          {total === 0 ? '記録なし' : `出席 ${h.attended} / ${total} 回`}
                          {p.attendanceStatus && (
                            <span className="ml-2 font-bold text-ink">
                              [{p.attendanceStatus === 'attended' ? '出席' : '無断欠席'}]
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* 手動選定 / 判定操作 */}
                        {canLottery &&
                          (p.status === 'applied' || p.status === 'waitlisted') && (
                            <form method="post" action={`/participations/${p.id}/decide`}>
                              <input type="hidden" name="decision" value="accepted" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                当選
                              </button>
                            </form>
                          )}
                        {canLottery && p.status === 'applied' && (
                          <>
                            <form method="post" action={`/participations/${p.id}/decide`}>
                              <input type="hidden" name="decision" value="waitlisted" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                補欠
                              </button>
                            </form>
                            <form method="post" action={`/participations/${p.id}/decide`}>
                              <input type="hidden" name="decision" value="rejected" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                落選
                              </button>
                            </form>
                          </>
                        )}
                        {/* 支払い管理 */}
                        {p.paymentId && p.paymentStatus && (
                          <span
                            className={`border px-2 py-1 text-sm font-bold ${
                              p.paymentStatus === 'paid' || p.paymentStatus === 'waived'
                                ? 'border-accent-2 text-accent-2'
                                : 'border-accent text-accent'
                            }`}
                          >
                            {PAYMENT_LABEL[p.paymentStatus]}
                            {p.paymentAmount != null && ` ¥${YEN.format(p.paymentAmount)}`}
                          </span>
                        )}
                        {canAttendance && p.paymentId && p.paymentStatus === 'pending' && (
                          <form method="post" action={`/payments/${p.paymentId}/mark`}>
                            <input type="hidden" name="status" value="paid" />
                            <button type="submit" className="btn-quiet cursor-pointer text-sm">
                              支払済みにする
                            </button>
                          </form>
                        )}
                        {canAttendance &&
                          p.paymentId &&
                          p.paymentStatus === 'refund_required' && (
                            <form method="post" action={`/payments/${p.paymentId}/mark`}>
                              <input type="hidden" name="status" value="refunded" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                返金済みにする
                              </button>
                            </form>
                          )}
                        {/* 出欠記録(確定者のみ) */}
                        {canAttendance && p.status === 'accepted' && (
                          <>
                            <form method="post" action={`/participations/${p.id}/attendance`}>
                              <input type="hidden" name="status" value="attended" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                出席
                              </button>
                            </form>
                            <form method="post" action={`/participations/${p.id}/attendance`}>
                              <input type="hidden" name="status" value="no_show" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                無断欠席
                              </button>
                            </form>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

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
