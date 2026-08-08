import { Link } from 'waku';
import {
  unstable_getRequest as getRequest,
  unstable_notFound as notFound,
} from 'waku/router/server';
import { Markdown } from '../../../../../lib/markdown';
import { getCurrentUser } from '../../../../../server/current-user';
import {
  getDb,
  getEventDetail,
  getOwnParticipations,
  listVisibleParticipants,
} from '../../../../../server/data';
import { hasGroupPermission } from '../../../../../server/route-auth';

function formatDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(d);
}

const SLOT_METHOD_LABEL = { fcfs: '先着', lottery: '抽選' } as const;

const TIME_FMT = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tokyo',
});

const STATUS_LABEL: Record<string, string> = {
  applied: '抽選待ち',
  accepted: '参加確定',
  waitlisted: '補欠',
  consent_pending: '繰上承諾待ち',
  rejected: '落選',
};

const ERROR_MESSAGES: Record<string, string> = {
  full: 'この枠は満席です(補欠枠も含む)。',
  already: 'この枠には既に申し込み済みです。',
  condition: '参加条件を満たしていません。',
  slot_invalid: '枠の入力内容を確認してください。',
};

export default async function EventPage({
  handle,
  eventId,
}: {
  handle: string;
  eventId: string;
}) {
  const db = await getDb();
  const detail = await getEventDetail(db, eventId);
  if (!detail) return notFound();
  if (detail.groupActor?.handle !== handle) return notFound();

  const user = await getCurrentUser();
  const canEdit = user
    ? await hasGroupPermission(db, detail.event.groupActorId, user.actorId, 'event.edit')
    : false;

  // 下書きは編集権限を持つメンバーだけが見られる
  if (detail.event.visibility !== 'public' && !canEdit) return notFound();

  const { event, groupActor, slots, slotStats, sessions, materials } = detail;
  const ownParticipations = user
    ? await getOwnParticipations(db, eventId, user.actorId)
    : new Map<
        string,
        { id: string; slotId: string; status: string; hiddenFromList: boolean }
      >();
  const participants = event.participantListPublic
    ? await listVisibleParticipants(db, eventId)
    : [];

  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');
  const errorReason = url.searchParams.get('reason');

  return (
    <article>
      <title>{`${event.title} - Yorox`}</title>
      <p className="text-sm">
        <Link to={`/g/${handle}`} className="link">
          {groupActor?.displayName}
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">{event.title}</h1>

      {/* ---- 開催情報(最重要情報のブロック) ---- */}
      <dl className="mt-5 border-2 border-ink">
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-rule p-3">
          <dt className="meta-mono w-14 shrink-0 text-sm text-neutral">日時</dt>
          <dd className="font-bold">
            {formatDate(event.startsAt, event.timezone)}
            {event.endsAt && (
              <span className="font-normal text-neutral">
                {' 〜 '}
                {formatDate(event.endsAt, event.timezone)}
              </span>
            )}
          </dd>
        </div>
        {(event.venueName || event.venueAddress) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-rule p-3 last:border-b-0">
            <dt className="meta-mono w-14 shrink-0 text-sm text-neutral">会場</dt>
            <dd className="min-w-0 flex-1">
              <span className="font-bold">{event.venueName}</span>
              {event.venueAddress && (
                <span className="block text-sm text-neutral">{event.venueAddress}</span>
              )}
              {event.venueLat != null && event.venueLng != null && (
                <iframe
                  title="会場の地図"
                  className="mt-3 h-64 w-full border border-rule"
                  loading="lazy"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${event.venueLng - 0.004}%2C${event.venueLat - 0.0025}%2C${event.venueLng + 0.004}%2C${event.venueLat + 0.0025}&layer=mapnik&marker=${event.venueLat}%2C${event.venueLng}`}
                />
              )}
              {(event.venueAddress || event.venueName) && (
                <span className="mt-2 flex flex-wrap gap-4 text-sm">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      event.venueAddress ?? event.venueName ?? '',
                    )}`}
                    className="link"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Google マップで開く
                  </a>
                  {event.venueLat != null && event.venueLng != null && (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${event.venueLat}&mlon=${event.venueLng}#map=17/${event.venueLat}/${event.venueLng}`}
                      className="link"
                      rel="noreferrer"
                      target="_blank"
                    >
                      OpenStreetMap で開く
                    </a>
                  )}
                </span>
              )}
            </dd>
          </div>
        )}
        {event.onlineUrl && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 p-3">
            <dt className="meta-mono w-14 shrink-0 text-sm text-neutral">配信</dt>
            <dd className="min-w-0">
              <a href={event.onlineUrl} className="link break-all" rel="noreferrer">
                {event.onlineUrl}
              </a>
            </dd>
          </div>
        )}
      </dl>

      {/* ---- 目次(存在するセクションのみ) ---- */}
      <nav aria-label="目次" className="mt-4 overflow-x-auto">
        <ul className="flex w-max gap-2 text-sm">
          {[
            event.descriptionMd && { href: '#overview', label: 'イベント概要' },
            slots.length > 0 && { href: '#slots', label: '参加枠' },
            sessions.length > 0 && {
              href: '#sessions',
              label: event.sessionsLabel === 'timetable' ? 'タイムテーブル' : 'セッション',
            },
            materials.length > 0 && { href: '#materials', label: '資料' },
            event.participantListPublic &&
              participants.length > 0 && { href: '#participants', label: '参加者' },
          ]
            .filter((item): item is { href: string; label: string } => Boolean(item))
            .map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="block whitespace-nowrap border border-ink px-3 py-1.5 font-bold hover:bg-paper-2"
                >
                  {item.label}
                </a>
              </li>
            ))}
        </ul>
      </nav>

      {error && (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          {error === 'condition' && errorReason
            ? errorReason
            : (ERROR_MESSAGES[error] ?? 'エラーが発生しました。')}
        </p>
      )}

      {canEdit && (
        <p className="mt-4 flex gap-3">
          <Link to={`/g/${handle}/events/${eventId}/edit`} className="btn-quiet inline-block">
            編集
          </Link>
          <Link to={`/g/${handle}/events/${eventId}/manage`} className="btn-quiet inline-block">
            管理コンソール
          </Link>
        </p>
      )}

      {canEdit && event.visibility === 'draft' && (
        <div className="mt-6 border-2 border-ink bg-paper-2 p-4">
          <p className="font-bold">これは下書きです(主催メンバーにのみ表示)</p>
          <p className="mt-1 text-sm text-neutral">
            参加枠を設定してから公開してください。公開すると一覧に載り、申込を受け付けます。
          </p>
          {slots.length > 0 && (
            <form method="post" action={`/events/${event.id}/publish`} className="mt-3">
              <button type="submit" className="btn cursor-pointer">
                公開する
              </button>
            </form>
          )}
        </div>
      )}

      {event.descriptionMd && (
        <section id="overview" className="mt-8 scroll-mt-4">
          <h2 className="display border-b-2 border-ink pb-2 t-md">イベント概要</h2>
          <div className="mt-3">
            <Markdown source={event.descriptionMd} />
          </div>
        </section>
      )}

      {/* ---- 参加者への案内(参加確定者と主催のみ) ---- */}
      {event.participantInfoMd &&
        (canEdit ||
          [...ownParticipations.values()].some((p) => p.status === 'accepted')) && (
          <section className="mt-8 border-2 border-accent-2 p-4">
            <h2 className="display t-md text-accent-2">参加者への案内</h2>
            <p className="meta-mono mt-0.5 text-sm text-neutral">
              参加確定者にのみ表示されています
            </p>
            <div className="mt-3">
              <Markdown source={event.participantInfoMd} />
            </div>
          </section>
        )}

      <section id="slots" className="mt-10 scroll-mt-4">
        <h2 className="display border-b-2 border-ink pb-2 t-md">参加枠</h2>
        {slots.length === 0 ? (
          <p className="mt-3 text-neutral">参加枠は未設定です。</p>
        ) : (
          <ul>
            {slots.map((slot) => {
              const stats = slotStats.get(slot.id);
              const own = ownParticipations.get(slot.id);
              return (
                <li
                  key={slot.id}
                  className="flex flex-wrap items-center justify-between gap-4 border-b border-rule py-4"
                >
                  <div className="min-w-0">
                    <div className="font-bold">{slot.name}</div>
                    <div className="mt-0.5 text-sm text-neutral">
                      {SLOT_METHOD_LABEL[slot.method]} · 定員 {slot.capacity} 名
                      {slot.method === 'lottery' && slot.lotteryAt && (
                        <> · 抽選 {formatDate(slot.lotteryAt, event.timezone)}</>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <div className="meta-mono text-right text-sm">
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
                    {event.visibility === 'public' &&
                      (own ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="border-2 border-accent-2 px-3 py-1.5 text-sm font-bold text-accent-2">
                            {STATUS_LABEL[own.status] ?? own.status}
                          </span>
                          <form method="post" action={`/participations/${own.id}/visibility`}>
                            <input
                              type="hidden"
                              name="hidden"
                              value={own.hiddenFromList ? '0' : '1'}
                            />
                            <button
                              type="submit"
                              className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-ink"
                            >
                              {own.hiddenFromList ? '一覧に表示する' : '一覧に表示しない'}
                            </button>
                          </form>
                          <form method="post" action={`/participations/${own.id}/cancel`}>
                            <button
                              type="submit"
                              className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-ink"
                            >
                              キャンセル
                            </button>
                          </form>
                        </div>
                      ) : user ? (
                        <form method="post" action={`/slots/${slot.id}/join`}>
                          <button type="submit" className="btn cursor-pointer">
                            申し込む
                          </button>
                        </form>
                      ) : (
                        <Link to="/login" className="btn-quiet">
                          ログインして申し込む
                        </Link>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canEdit && (
          <details className="mt-6 border-2 border-ink">
            <summary className="cursor-pointer p-3 font-bold">枠を追加(主催)</summary>
            <form
              method="post"
              action={`/events/${event.id}/slots`}
              className="space-y-5 border-t-2 border-ink p-4"
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold">枠名 *</span>
                  <input
                    type="text"
                    name="name"
                    required
                    maxLength={100}
                    className="input mt-1"
                    placeholder="一般参加"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold">定員 *</span>
                  <input
                    type="number"
                    name="capacity"
                    required
                    min={1}
                    className="input meta-mono mt-1"
                  />
                </label>
              </div>

              <fieldset>
                <legend className="text-sm font-bold">方式</legend>
                <div className="mt-1 flex gap-6">
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="radio" name="method" value="fcfs" defaultChecked /> 先着
                  </label>
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="radio" name="method" value="lottery" /> 抽選
                  </label>
                </div>
              </fieldset>

              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold">抽選ロジック(抽選時)</span>
                  <select name="lottery_logic" className="input mt-1">
                    <option value="random">完全ランダム</option>
                    <option value="weighted">出欠率による重み付け</option>
                    <option value="manual">主催の手動選定</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold">抽選日時(抽選時)</span>
                  <input type="datetime-local" name="lottery_at" className="input meta-mono mt-1" />
                </label>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold">補欠モデル</span>
                  <select name="waitlist_model" className="input mt-1">
                    <option value="connpass">落選・溢れは補欠(Connpass 流)</option>
                    <option value="separate">補欠数を指定する</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold">補欠定員(指定時)</span>
                  <input type="number" name="waitlist_capacity" min={0} className="input meta-mono mt-1" />
                </label>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold">繰上ポリシー</span>
                  <select name="promotion_policy" className="input mt-1">
                    <option value="auto">即時自動</option>
                    <option value="auto_deadline">締切付き自動</option>
                    <option value="consent">本人承諾型</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold">繰上停止(開催の何時間前)</span>
                  <input
                    type="number"
                    name="promotion_deadline_hours"
                    min={0}
                    className="input meta-mono mt-1"
                  />
                </label>
              </div>

              <fieldset>
                <legend className="text-sm font-bold">参加条件(AND)</legend>
                <div className="mt-1 space-y-2">
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" name="require_claimed" />
                    claim 済み(またはローカル)アカウントのみ
                  </label>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm">アカウント作成からの最低日数</span>
                      <input
                        type="number"
                        name="min_account_age_days"
                        min={0}
                        className="input meta-mono mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm">参加実績の最低回数</span>
                      <input
                        type="number"
                        name="min_attended_count"
                        min={0}
                        className="input meta-mono mt-1"
                      />
                    </label>
                  </div>
                </div>
              </fieldset>

              <button type="submit" className="btn cursor-pointer">
                枠を追加
              </button>
            </form>
          </details>
        )}
      </section>

      {sessions.length > 0 && (
        <section id="sessions" className="mt-10 scroll-mt-4">
          <h2 className="display border-b-2 border-ink pb-2 t-md">
            {event.sessionsLabel === 'timetable' ? 'タイムテーブル' : 'セッション'}
          </h2>
          <ul>
            {sessions.map((session) => (
              <li
                key={session.id}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 border-b border-rule py-4"
              >
                <div className="meta-mono pt-0.5 text-sm text-neutral">
                  {session.startsAt ? (
                    <>
                      {TIME_FMT.format(session.startsAt)}
                      {session.endsAt && (
                        <span className="block">| {TIME_FMT.format(session.endsAt)}</span>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-bold">{session.title}</div>
                  {session.speakerName && (
                    <div className="mt-0.5 text-sm text-neutral">{session.speakerName}</div>
                  )}
                  {session.descriptionMd && (
                    <p className="mt-2 max-w-[65ch] whitespace-pre-wrap text-sm">
                      {session.descriptionMd}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {materials.length > 0 && (
        <section id="materials" className="mt-10 scroll-mt-4">
          <h2 className="display border-b-2 border-ink pb-2 t-md">資料</h2>
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

      {event.participantListPublic && participants.length > 0 && (
        <section id="participants" className="mt-10 scroll-mt-4">
          <h2 className="display border-b-2 border-ink pb-2 t-md">参加者</h2>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {participants.map((p) => (
              <li key={`${p.slotId}-${p.actorId}`}>
                {p.handle ? (
                  <Link to={`/g/${p.handle}`} className="link">
                    {p.displayName}
                  </Link>
                ) : (
                  p.displayName
                )}
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
