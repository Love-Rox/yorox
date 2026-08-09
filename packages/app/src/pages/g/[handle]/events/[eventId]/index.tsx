import { Link } from 'waku';
import {
  unstable_getRequest as getRequest,
  unstable_notFound as notFound,
} from 'waku/router/server';
import { ActorName } from '../../../../../components/actor-name';
import { Avatar } from '../../../../../components/avatar';
import { HelpTip } from '../../../../../components/help-tip';
import { ServiceIcon } from '../../../../../components/service-icon';
import { Markdown } from '../../../../../lib/markdown';
import { getCurrentUser } from '../../../../../server/current-user';
import {
  getDb,
  getEventDetail,
  getOwnParticipations,
  listOrganizers,
  listVisibleParticipants,
} from '../../../../../server/data';
import { hasGroupPermission } from '../../../../../server/route-auth';

const TZ = 'Asia/Tokyo';
const TIME_FMT = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TZ,
});
const MD_FMT = new Intl.DateTimeFormat('ja-JP', {
  month: '2-digit',
  day: '2-digit',
  timeZone: TZ,
});
const YEAR_FMT = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', timeZone: TZ });
const WD_FMT = new Intl.DateTimeFormat('ja-JP', { weekday: 'short', timeZone: TZ });
const FULL_FMT = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: TZ,
});

const SLOT_METHOD_LABEL = { fcfs: '先着', lottery: '抽選' } as const;

const STATUS_LABEL: Record<string, string> = {
  applied: '抽選待ち',
  accepted: '参加確定',
  payment_pending: '支払い待ち',
  waitlisted: '補欠',
  consent_pending: '繰上承諾待ち',
  rejected: '落選',
};

const YEN = new Intl.NumberFormat('ja-JP');

const ERROR_MESSAGES: Record<string, string> = {
  full: 'この枠は満席です(補欠枠も含む)。',
  already: 'この枠には既に申し込み済みです。',
  condition: '参加条件を満たしていません。',
  slot_invalid: '枠の入力内容を確認してください。',
};

/** OGP description 用に Markdown 記法をざっくり落とす */
function plainDescription(md: string | null, max = 120): string {
  if (!md) return '';
  return md
    .replace(/[#>*`_\[\]]|\(https?:[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

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
  const organizers = await listOrganizers(db, event.groupActorId);
  // 登壇者: セッション由来 + 登壇枠の確定参加者(重複はセッション優先)
  const speakerSlotIds = new Set(slots.filter((s) => s.isSpeakerSlot).map((s) => s.id));
  const slotSpeakers = participants
    .filter((p) => speakerSlotIds.has(p.slotId))
    .map((p) => ({
      name: p.displayName,
      // 連携済みリモートは自サーバーのプロフィールを優先
      url: p.claimedHandle
        ? `/u/${p.claimedHandle}`
        : p.domain
          ? p.uri
          : p.handle
            ? `/u/${p.handle}`
            : null,
      emojis: p.emojis,
    }));
  const speakers = [
    ...new Map(
      [
        ...slotSpeakers,
        ...sessions
          .filter((s) => s.speakerName)
          .map((s) => ({ name: s.speakerName!, url: s.speakerUrl, emojis: null })),
      ].map((sp) => [sp.name, sp]),
    ).values(),
  ];

  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');
  const errorReason = url.searchParams.get('reason');

  const sessionsLabel = event.sessionsLabel === 'timetable' ? 'タイムテーブル' : 'セッション';
  const sameDay =
    !event.endsAt || MD_FMT.format(event.startsAt) === MD_FMT.format(event.endsAt);
  const ogDescription =
    plainDescription(event.descriptionMd) ||
    `${FULL_FMT.format(event.startsAt)} 開催 · ${groupActor?.displayName ?? ''}`;
  const canonicalUrl = `${url.origin}/g/${handle}/events/${eventId}`;
  // 自ホスティング(/files/…)の相対 URL は OGP 用に絶対化する
  const ogImage = event.thumbnailUrl
    ? event.thumbnailUrl.startsWith('/')
      ? `${url.origin}${event.thumbnailUrl}`
      : event.thumbnailUrl
    : null;

  return (
    <article>
      <title>{`${event.title} - Yorox`}</title>
      {/* ---- OGP ---- */}
      <meta property="og:type" content="website" />
      <meta property="og:title" content={event.title} />
      <meta property="og:description" content={ogDescription} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:site_name" content="Yorox" />
      {ogImage && <meta property="og:image" content={ogImage} />}
      <meta
        name="twitter:card"
        content={event.thumbnailUrl ? 'summary_large_image' : 'summary'}
      />
      <meta name="description" content={ogDescription} />

      <p className="flex items-center gap-2">
        <span className="meta-mono border border-ink px-2 py-0.5 text-sm text-neutral">
          主催
        </span>
        <Link to={`/g/${handle}`} className="link font-bold">
          {groupActor?.displayName}
        </Link>
      </p>

      {/* ---- ヘッダー: 日付を主役に ---- */}
      <header className="mt-3 flex flex-wrap items-start gap-x-8 gap-y-4">
        <div className="shrink-0 border-b-4 border-accent pb-2">
          <div className="meta-mono text-sm text-neutral">{YEAR_FMT.format(event.startsAt)}</div>
          <div className="display t-display mt-1 leading-none">
            {MD_FMT.format(event.startsAt)}
            <span className="ml-2 text-[0.4em] text-neutral">
              ({WD_FMT.format(event.startsAt)})
            </span>
          </div>
          <div className="meta-mono mt-2 font-bold">
            {TIME_FMT.format(event.startsAt)}
            {event.endsAt && (
              <>
                {' – '}
                {sameDay
                  ? TIME_FMT.format(event.endsAt)
                  : `${MD_FMT.format(event.endsAt)} ${TIME_FMT.format(event.endsAt)}`}
              </>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="display t-xl">{event.title}</h1>
          {canEdit && (
            <p className="mt-3 flex flex-wrap gap-3">
              <Link
                to={`/g/${handle}/events/${eventId}/edit`}
                className="btn-quiet inline-block"
              >
                編集
              </Link>
              <Link
                to={`/g/${handle}/events/${eventId}/manage`}
                className="btn-quiet inline-block"
              >
                管理コンソール
              </Link>
            </p>
          )}
        </div>
      </header>

      {event.thumbnailUrl && (
        <img
          referrerPolicy="no-referrer"
          src={event.thumbnailUrl}
          alt=""
          className="mt-6 max-h-96 w-full border border-rule object-cover"
        />
      )}

      {error && (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          {error === 'condition' && errorReason
            ? errorReason
            : (ERROR_MESSAGES[error] ?? 'エラーが発生しました。')}
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

      {/* ---- 目次(ページ内リンク) ---- */}
      <nav aria-label="目次" className="mt-6 overflow-x-auto border-b border-rule pb-3">
        <ul className="flex w-max gap-2 text-sm">
          {[
            event.descriptionMd && { href: '#overview', label: 'イベント概要' },
            { href: '#slots', label: '参加枠' },
            sessions.length > 0 && { href: '#sessions', label: sessionsLabel },
            materials.length > 0 && { href: '#materials', label: '資料' },
            { href: '#organizers', label: '主催' },
            ...(speakers.length > 0 ? [{ href: '#speakers', label: '登壇' }] : []),
            event.participantListPublic &&
              participants.length > 0 && { href: '#participants', label: '参加者' },
            (event.venueName || event.onlineUrl) && {
              href: '#venue',
              label: '会場・配信',
            },
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

      {/* ---- 2カラム(SP: 申込パネル → コンテンツ の順) ---- */}
      <div className="mt-8 flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        {/* ---- サイドバー: 申込 + 会場 ---- */}
        <aside className="order-1 space-y-8 lg:order-2">
          <section id="slots" className="scroll-mt-4 border-2 border-ink">
            <h2 className="display border-b-2 border-ink p-3 t-md">参加枠</h2>
            {slots.length === 0 ? (
              <p className="p-3 text-sm text-neutral">参加枠は未設定です。</p>
            ) : (
              <ul>
                {slots.map((slot) => {
                  const stats = slotStats.get(slot.id);
                  const own = ownParticipations.get(slot.id);
                  return (
                    <li key={slot.id} className="border-b border-rule p-3 last:border-b-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold">{slot.name}</div>
                          <div className="mt-0.5 text-sm text-neutral">
                            {SLOT_METHOD_LABEL[slot.method]} · 定員 {slot.capacity} 名
                            {slot.price != null && slot.price > 0 && (
                              <span className="ml-1 font-bold text-ink">
                                · ¥{YEN.format(slot.price)}
                                <span className="font-normal text-neutral">
                                  ({slot.paymentMethod === 'onsite' ? '現地払い' : '事前決済'})
                                </span>
                              </span>
                            )}
                          </div>
                          {slot.method === 'lottery' && slot.lotteryAt && (
                            <div className="meta-mono text-sm text-neutral">
                              抽選 {FULL_FMT.format(slot.lotteryAt)}
                            </div>
                          )}
                          {(slot.isSpeakerSlot || slot.allowRemote) && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {slot.isSpeakerSlot && (
                                <span className="inline-block border border-accent-2 px-1.5 py-0.5 text-sm text-accent-2">
                                  登壇枠
                                </span>
                              )}
                              {slot.allowRemote && (
                                <span className="inline-block border border-neutral px-1.5 py-0.5 text-sm text-neutral">
                                  Fediverse 参加可
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="meta-mono shrink-0 text-right">
                          <span className="t-md font-bold">{stats?.accepted ?? 0}</span>
                          <span className="text-sm text-neutral"> / {slot.capacity}</span>
                          {(stats?.waitlisted ?? 0) > 0 && (
                            <div className="text-sm text-neutral">
                              補欠 {stats?.waitlisted}
                            </div>
                          )}
                        </div>
                      </div>
                      {event.visibility === 'public' && (
                        <div className="mt-3">
                          {own ? (
                            <div className="flex flex-wrap items-center gap-3">
                              <span
                                className={`border-2 px-3 py-1.5 text-sm font-bold ${
                                  own.status === 'payment_pending'
                                    ? 'border-accent text-accent'
                                    : 'border-accent-2 text-accent-2'
                                }`}
                              >
                                {STATUS_LABEL[own.status] ?? own.status}
                              </span>
                              {own.status === 'payment_pending' &&
                                (slot.paymentMethod === 'external' && slot.paymentUrl ? (
                                  <a
                                    href={slot.paymentUrl}
                                    className="btn cursor-pointer"
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    支払いへ進む
                                  </a>
                                ) : (
                                  <span className="text-sm text-neutral">
                                    当日、会場でお支払いください
                                  </span>
                                ))}
                              <form
                                method="post"
                                action={`/participations/${own.id}/visibility`}
                              >
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
                              <form
                                method="post"
                                action={`/participations/${own.id}/cancel`}
                              >
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
                              <button type="submit" className="btn w-full cursor-pointer">
                                申し込む
                              </button>
                            </form>
                          ) : (
                            <Link to="/login" className="btn-quiet block text-center">
                              ログインして申し込む
                            </Link>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {event.visibility === 'public' &&
              (event.remoteJoinMethods ?? []).includes('reply') &&
              slots.some((s) => s.allowRemote) && (
                <p className="border-t border-rule p-3 text-sm text-neutral">
                  Fediverse(Misskey / Mastodon 等)からは、主催グループをフォローして
                  このイベントの告知に「参加」とリプライすると申込できます。
                  キャンセルは「キャンセル」とリプライしてください。
                </p>
              )}
            {canEdit && (
              <details className="border-t-2 border-ink">
                <summary className="cursor-pointer p-3 text-sm font-bold">
                  枠を追加(主催)
                </summary>
                <form
                  method="post"
                  action={`/events/${event.id}/slots`}
                  className="space-y-4 border-t border-rule p-3"
                >
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
                  <fieldset>
                    <legend className="text-sm font-bold">方式<HelpTip text="先着: 申込順に確定し、満席後は補欠。抽選: 申込を集めて抽選日時に当選者を決定します。" /></legend>
                    <div className="mt-1 flex gap-6">
                      <label className="flex min-h-11 items-center gap-2">
                        <input type="radio" name="method" value="fcfs" defaultChecked /> 先着
                      </label>
                      <label className="flex min-h-11 items-center gap-2">
                        <input type="radio" name="method" value="lottery" /> 抽選
                      </label>
                    </div>
                  </fieldset>
                  <label className="block">
                    <span className="text-sm font-bold">抽選ロジック(抽選時)<HelpTip text="完全ランダム: 全員同確率。出欠率重み付け: 過去の出席実績が高い人が当たりやすくなります。手動選定: 管理画面で主催者が一人ずつ当選・補欠・落選を決めます。" /></span>
                    <select name="lottery_logic" className="input mt-1">
                      <option value="random">完全ランダム</option>
                      <option value="weighted">出欠率による重み付け</option>
                      <option value="manual">主催の手動選定</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-bold">抽選日時(抽選時)</span>
                    <input
                      type="datetime-local"
                      name="lottery_at"
                      className="input meta-mono mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-bold">補欠モデル<HelpTip text="Connpass 流: 落選や定員溢れは全員自動的に補欠になります。指定する: 補欠の人数にも上限を設けます。" /></span>
                    <select name="waitlist_model" className="input mt-1">
                      <option value="connpass">落選・溢れは補欠(Connpass 流)</option>
                      <option value="separate">補欠数を指定する</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-bold">補欠定員(指定時)</span>
                    <input
                      type="number"
                      name="waitlist_capacity"
                      min={0}
                      className="input meta-mono mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-bold">繰上ポリシー<HelpTip text="キャンセルで空きが出たときの補欠の扱い。即時自動: すぐ繰上げ。締切付き自動: 開催 X 時間前以降は繰上げない。承諾制: 本人が承諾したら確定します。" /></span>
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
                  <fieldset>
                    <legend className="text-sm font-bold">参加費</legend>
                    <label className="mt-1 block">
                      <span className="text-sm">金額(円。空欄で無料)</span>
                      <input
                        type="number"
                        name="price"
                        min={0}
                        className="input meta-mono mt-1"
                        placeholder="1000"
                      />
                    </label>
                    <label className="mt-2 block">
                      <span className="text-sm">支払方法</span>
                      <select name="payment_method" className="input mt-1">
                        <option value="onsite">現地払い</option>
                        <option value="external">外部決済リンク</option>
                      </select>
                    </label>
                    <label className="mt-2 block">
                      <span className="text-sm">決済 URL(外部決済リンク時)</span>
                      <input
                        type="url"
                        name="payment_url"
                        className="input meta-mono mt-1"
                        placeholder="https://buy.stripe.com/…"
                      />
                    </label>
                    <label className="mt-2 block">
                      <span className="text-sm">確定条件</span>
                      <select name="payment_confirm" className="input mt-1">
                        <option value="independent">申込/当選で確定(支払いは別管理)</option>
                        <option value="required">支払い確認で確定</option>
                      </select>
                    </label>
                  </fieldset>
                  <fieldset>
                    <legend className="text-sm font-bold">参加条件(AND)<HelpTip text="すべての条件を満たす人だけが申込できます。満たさない申込は理由付きで断られます。" /></legend>
                    <label className="mt-1 flex min-h-11 items-center gap-2">
                      <input type="checkbox" name="require_claimed" />
                      アカウント連携済み(本人確認済み)の人のみ
                      <HelpTip text="Fediverse からの申込者のうち、プロフィール設定で Yorox アカウントと連携済みの人に限定します。Yorox アカウントで直接申し込む人は常に対象です。" />
                    </label>
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
                  </fieldset>
                  <fieldset>
                    <legend className="text-sm font-bold">登壇枠<HelpTip text="LT 枠・発表枠など。参加確定した人はイベントページの「主催・登壇」欄にも登壇者として表示されます。" /></legend>
                    <label className="mt-1 flex min-h-11 items-center gap-2">
                      <input type="checkbox" name="is_speaker_slot" />
                      登壇枠にする(確定者を登壇者として表示)
                    </label>
                  </fieldset>
                  <fieldset>
                    <legend className="text-sm font-bold">連合(Fediverse)<HelpTip text="オンにすると、Misskey / Mastodon などのアカウントのまま(Yorox 未登録でも)この枠に参加申込できます。告知へのリプライ「参加」で申し込め、結果はリプライで届きます。" /></legend>
                    <label className="mt-1 flex min-h-11 items-center gap-2">
                      <input type="checkbox" name="allow_remote" />
                      リモート参加を受け入れる(Misskey / Mastodon 等からの申込)
                    </label>
                  </fieldset>
                  <button type="submit" className="btn cursor-pointer">
                    枠を追加
                  </button>
                </form>
              </details>
            )}
          </section>

          {(event.venueName || event.venueAddress || event.onlineUrl) && (
            <section id="venue" className="scroll-mt-4">
              <h2 className="display border-b-2 border-ink pb-2 t-md">会場・配信</h2>
              {(event.venueName || event.venueAddress) && (
                <div className="mt-3">
                  <div className="font-bold">{event.venueName}</div>
                  {event.venueAddress && (
                    <div className="text-sm text-neutral">{event.venueAddress}</div>
                  )}
                  {event.venueLat != null && event.venueLng != null && (
                    <iframe
                      title="会場の地図"
                      className="mt-3 h-56 w-full border border-rule"
                      loading="lazy"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${event.venueLng - 0.004}%2C${event.venueLat - 0.0025}%2C${event.venueLng + 0.004}%2C${event.venueLat + 0.0025}&layer=mapnik&marker=${event.venueLat}%2C${event.venueLng}`}
                    />
                  )}
                  <div className="mt-2 flex flex-wrap gap-4 text-sm">
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
                  </div>
                </div>
              )}
              {event.onlineUrl && (
                <div className="mt-3 text-sm">
                  <span className="meta-mono text-neutral">配信: </span>
                  <a
                    href={event.onlineUrl}
                    className="link break-all"
                    rel="noreferrer"
                  >
                    {event.onlineUrl}
                  </a>
                </div>
              )}
            </section>
          )}
        </aside>

        {/* ---- メインコンテンツ ---- */}
        <div className="order-2 min-w-0 lg:order-1 [&>section:first-child]:mt-0">
          {event.descriptionMd && (
            <section id="overview" className="mt-8 scroll-mt-4">
              <h2 className="display border-b-2 border-ink pb-2 t-md">イベント概要</h2>
              <div className="mt-3">
                <Markdown source={event.descriptionMd} />
              </div>
            </section>
          )}

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

          {sessions.length > 0 && (
            <section id="sessions" className="mt-10 scroll-mt-4">
              <h2 className="display border-b-2 border-ink pb-2 t-md">{sessionsLabel}</h2>
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
                        <div className="mt-0.5 text-sm text-neutral">
                          {session.speakerUrl ? (
                            <a
                              href={session.speakerUrl}
                              className="link inline-flex items-center gap-1"
                              rel="noreferrer"
                              target="_blank"
                            >
                              <ServiceIcon url={session.speakerUrl} />
                              {session.speakerName}
                            </a>
                          ) : (
                            session.speakerName
                          )}
                        </div>
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

          {/* ---- 主催 ---- */}
          <section id="organizers" className="mt-10 scroll-mt-4">
            <h2 className="display border-b-2 border-ink pb-2 t-md">主催</h2>
            <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <li className="font-bold">
                <Link to={`/g/${handle}`} className="link">
                  {groupActor?.displayName}
                </Link>
              </li>
              {organizers.map((o) => (
                <li key={o.actorId} className="flex items-center gap-2 text-sm">
                  <Avatar avatarUrl={o.avatarUrl} displayName={o.displayName} size="sm" />
                  {o.handle ? (
                    <Link to={`/u/${o.handle}`} className="link">
                      {o.displayName}
                    </Link>
                  ) : (
                    o.displayName
                  )}
                  <span className="meta-mono ml-1 text-neutral">({o.roleName})</span>
                </li>
              ))}
            </ul>
          </section>

          {/* ---- 登壇 ---- */}
          {speakers.length > 0 && (
            <section id="speakers" className="mt-10 scroll-mt-4">
              <h2 className="display border-b-2 border-ink pb-2 t-md">登壇</h2>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {speakers.map((sp) => (
                  <li key={`${sp.name}-${sp.url ?? ''}`}>
                    {sp.url ? (
                      <a
                        href={sp.url}
                        className="link inline-flex items-center gap-1"
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ServiceIcon url={sp.url} />
                        <ActorName name={sp.name} emojis={sp.emojis} />
                      </a>
                    ) : (
                      <ActorName name={sp.name} emojis={sp.emojis} />
                    )}
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
              <h2 className="display flex items-baseline justify-between border-b-2 border-ink pb-2 t-md">
                参加者
                <Link
                  to={`/g/${handle}/events/${eventId}/participants`}
                  className="link text-sm font-normal"
                >
                  一覧を見る
                </Link>
              </h2>
              {/* アイコンのみのグリッド(名前はホバー/長押しの title で) */}
              <ul className="mt-3 flex flex-wrap gap-2">
                {participants.map((p) => {
                  const label = p.domain
                    ? `${p.displayName} (@${p.handle}@${p.domain})`
                    : p.displayName;
                  const avatar = (
                    <Avatar avatarUrl={p.avatarUrl} displayName={p.displayName} />
                  );
                  return (
                    <li key={`${p.slotId}-${p.actorId}`} title={label}>
                      {p.domain && p.claimedHandle ? (
                        // 連携済みリモートは自サーバーのプロフィールへ
                        <Link to={`/u/${p.claimedHandle}`} aria-label={label}>
                          {avatar}
                        </Link>
                      ) : p.domain ? (
                        // 未連携リモートは本人の Fediverse プロフィールへ
                        <a href={p.uri} rel="noreferrer" target="_blank" aria-label={label}>
                          {avatar}
                        </a>
                      ) : p.handle ? (
                        <Link to={`/u/${p.handle}`} aria-label={label}>
                          {avatar}
                        </Link>
                      ) : (
                        avatar
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </article>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
