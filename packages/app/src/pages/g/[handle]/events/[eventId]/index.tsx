import { isViewable } from '../../../../../domain/visibility';
import { Link } from 'waku';
import { eq } from 'drizzle-orm';
import {
  unstable_getRequest as getRequest,
  unstable_notFound as notFound,
} from 'waku/router/server';
import { ActorName } from '../../../../../components/actor-name';
import { Avatar } from '../../../../../components/avatar';
import { ActorKindMark } from '../../../../../components/actor-kind';
import { HelpTip } from '../../../../../components/help-tip';
import { CopyLink } from '../../../../../components/copy-link';
import { CopyText } from '../../../../../components/copy-text';
import { ShareNative } from '../../../../../components/share-native';
import { Menu } from '../../../../../components/menu';
import { ServiceIcon } from '../../../../../components/service-icon';
import {
  announceText,
  formatHashtags,
  resolveHashtags,
  shareText,
} from '../../../../../lib/hashtags';
import { googleCalendarUrl } from '../../../../../lib/ics';
import { Markdown } from '../../../../../lib/markdown';
import { getCurrentUser } from '../../../../../server/current-user';
import {
  getDb,
  getEventDetail,
  getOwnParticipations,
  listOrganizers,
  listVisibleParticipants,
} from '../../../../../server/data';
import { schema } from '../../../../../db/client';
import { hasEventPermission } from '../../../../../server/route-auth';
import { SlotConditionBadges } from '../../../../../components/slot-conditions';
import { SlotFormFields } from '../../../../../components/slot-form-fields';

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
  blocked: 'このグループのイベントには参加できません。',
  slot_invalid: '枠の入力内容を確認してください。',
  discord_guild_invalid: 'Discord サーバー ID は 17〜20 桁の数字です。',
  discord_guild_missing:
    'Discord サーバーの条件を使うには、枠かグループ設定でサーバー ID を指定してください。',
  stripe: '決済処理を開始できませんでした。時間をおいて再度お試しください。',
  duplicate_failed: 'イベントを複製できませんでした。時間をおいて再度お試しください。',
  event_cancelled: 'このイベントは中止されたため申し込めません。',
  cancel_confirm: '中止するには確認欄に「中止」と入力してください。',
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
    ? await hasEventPermission(db, detail.event, user.actorId, 'event.edit')
    : false;

  // 下書きは編集権限を持つメンバーだけが見られる
  if (!isViewable(detail.event.visibility) && !canEdit) return notFound();

  const { event, groupActor, slots, slotStats, sessions, materials } = detail;
  const ownParticipations = user
    ? await getOwnParticipations(db, eventId, user.actorId)
    : new Map<
        string,
        { id: string; slotId: string; status: string; hiddenFromList: boolean; paymentId: string | null }
      >();
  const participants = event.participantListPublic
    ? await listVisibleParticipants(db, eventId, event.applicantListPublic)
    : [];
  const organizers = await listOrganizers(db, event.groupActorId);
  // 主催の種別バッジ・Stripe オプション判定に使うグループ行(常に取得)
  const groupRow = await db.query.groups.findFirst({
    where: eq(schema.groups.actorId, event.groupActorId),
  });
  const groupStripeConnected = canEdit && !!groupRow?.stripeAccountId;
  // 登壇者: セッション由来 + 登壇枠の確定参加者(重複はセッション優先)
  const speakerSlotIds = new Set(slots.filter((s) => s.isSpeakerSlot).map((s) => s.id));
  // 登壇者は参加が確定した人だけ(抽選待ちを載せる設定でも登壇者欄には出さない)
  const slotSpeakers = participants
    .filter((p) => p.status === 'accepted' && speakerSlotIds.has(p.slotId))
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
  const shortUrl = `${url.origin}/e/${eventId}`;
  // イベント側のタグが無ければグループ既定を使う
  const hashtags = resolveHashtags(event.hashtags, groupRow?.hashtags);
  const shareTextValue = shareText(event.title, hashtags);
  const announceTemplate = announceText({
    title: event.title,
    dateText: FULL_FMT.format(event.startsAt),
    venue: event.venueName ?? (event.onlineUrl ? 'オンライン開催' : null),
    groupName: groupActor?.displayName ?? null,
    url: shortUrl,
    tags: hashtags,
  });
  // 自ホスティング(/files/…)の相対 URL は OGP 用に絶対化する。
  // サムネイル未設定なら SVG で動的生成した OGP カードを使う
  const ogImage = event.thumbnailUrl
    ? event.thumbnailUrl.startsWith('/')
      ? `${url.origin}${event.thumbnailUrl}`
      : event.thumbnailUrl
    : `${url.origin}/events/${eventId}/ogp.png`;

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
      {!event.thumbnailUrl && (
        <>
          <meta property="og:image:type" content="image/png" />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
        </>
      )}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="description" content={ogDescription} />

      <p className="flex items-center gap-2">
        <span className="meta-mono border border-ink px-2 py-0.5 text-sm text-neutral">
          主催
        </span>
        <Link to={`/g/${handle}`} className="link inline-flex items-center gap-1.5 font-bold">
          <ActorKindMark kind="group" isPersonal={groupRow?.isPersonal} size={15} />
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
          <div className="mt-3 flex flex-wrap gap-3">
            {isViewable(event.visibility) && (
              <Menu label="カレンダーに追加">
                <a
                  href={`/events/${eventId}/calendar.ics`}
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                >
                  .ics をダウンロード
                </a>
                <a
                  href={googleCalendarUrl({
                    title: event.title,
                    start: event.startsAt,
                    end: event.endsAt,
                    location: event.venueName ?? (event.onlineUrl ? 'オンライン' : null),
                    details: canonicalUrl,
                  })}
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                  rel="noreferrer"
                  target="_blank"
                >
                  Google カレンダー
                </a>
              </Menu>
            )}
            {isViewable(event.visibility) && (
              <Menu label="共有">
                <a
                  href={`https://x.com/intent/post?${new URLSearchParams({
                    text: shareTextValue,
                    url: shortUrl,
                  })}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                >
                  X に投稿
                </a>
                <a
                  href={`https://misskey-hub.net/share/?${new URLSearchParams({
                    text: shareTextValue,
                    url: shortUrl,
                  })}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                >
                  Fediverse に共有(Misskey / Mastodon)
                </a>
                <a
                  href={`https://bsky.app/intent/compose?${new URLSearchParams({
                    text: `${shareTextValue} ${shortUrl}`,
                  })}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                >
                  Bluesky に投稿
                </a>
                <a
                  href={`https://social-plugins.line.me/lineit/share?${new URLSearchParams({
                    url: shortUrl,
                    text: shareTextValue,
                  })}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                >
                  LINE で送る
                </a>
                <a
                  href={`https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({
                    u: shortUrl,
                  })}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                >
                  Facebook でシェア
                </a>
                <a
                  href={`https://b.hatena.ne.jp/entry/panel/?${new URLSearchParams({
                    url: shortUrl,
                    title: event.title,
                  })}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                >
                  はてなブックマーク
                </a>
                <ShareNative title={event.title} url={shortUrl} />
                <div className="border-t border-rule px-3 py-2">
                  <p className="text-sm font-bold">短縮リンク</p>
                  <div className="mt-2">
                    <CopyLink url={shortUrl} />
                  </div>
                  {hashtags.length > 0 && (
                    <p className="meta-mono mt-2 text-sm text-neutral">
                      {formatHashtags(hashtags)}
                    </p>
                  )}
                </div>
                <div className="border-t border-rule px-3 py-2">
                  <p className="text-sm font-bold">告知文テンプレート</p>
                  <p className="mt-1 text-sm text-neutral">
                    そのままコピーして SNS やチャットに貼れます。
                  </p>
                  <div className="mt-2">
                    <CopyText text={announceTemplate} label="告知文" />
                  </div>
                </div>
              </Menu>
            )}
            {canEdit && (
              <Menu label="主催者メニュー">
                <a
                  href={`/g/${handle}/events/${eventId}/edit`}
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                >
                  編集
                </a>
                <a
                  href={`/g/${handle}/events/${eventId}/manage`}
                  className="block px-3 py-2 text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                >
                  管理コンソール
                </a>
                <form method="post" action={`/events/${eventId}/duplicate`}>
                  <button
                    type="submit"
                    className="block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-paper-2 focus-visible:bg-paper-2"
                  >
                    複製して新規作成
                  </button>
                </form>
              </Menu>
            )}
          </div>
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
          {event.publishAt && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-2 border-accent-2 p-3">
              <p className="text-sm font-bold text-accent-2">
                予約公開: {FULL_FMT.format(event.publishAt)}
                <span className="ml-2 font-normal text-neutral">
                  (5分間隔の処理のため数分前後します)
                </span>
              </p>
              <form method="post" action={`/events/${event.id}/schedule-cancel`}>
                <button
                  type="submit"
                  className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-ink"
                >
                  予約を取り消す
                </button>
              </form>
            </div>
          )}
          {slots.length > 0 && !event.publishAt && (
            <form
              method="post"
              action={`/events/${event.id}/schedule-publish`}
              className="mt-3 flex flex-wrap items-end gap-2"
            >
              <label className="block">
                <span className="text-sm font-bold">
                  予約公開
                  <HelpTip text="指定した日時に自動で公開されます(5分間隔の処理のため数分前後します)。公開時にフォロワーへの告知や Bluesky クロスポストも同時に行われます。" />
                </span>
                <input
                  type="datetime-local"
                  name="publish_at"
                  required
                  className="input meta-mono mt-1"
                />
              </label>
              <button type="submit" className="btn-quiet cursor-pointer">
                予約する
              </button>
            </form>
          )}
          {slots.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <form method="post" action={`/events/${event.id}/publish`}>
                <button type="submit" className="btn cursor-pointer">
                  {event.publishAt ? '予約を待たず今すぐ公開する' : '公開する'}
                </button>
              </form>
              <form method="post" action={`/events/${event.id}/publish`}>
                <input type="hidden" name="visibility" value="unlisted" />
                <button type="submit" className="btn-quiet cursor-pointer">
                  限定公開にする
                </button>
              </form>
              <span className="text-sm text-neutral">
                限定公開は URL を知っている人だけが閲覧・申込できます
                (一覧・検索・Fediverse 告知には出ません)
              </span>
            </div>
          )}
        </div>
      )}

      {/* ---- 主催者: イベントの中止 ---- */}
      {canEdit && !event.cancelledAt && isViewable(event.visibility) && (
        <details className="mt-6 border-2 border-rule">
          <summary className="cursor-pointer p-3 text-sm font-bold text-neutral">
            イベントを中止する
          </summary>
          <div className="border-t border-rule p-4">
            <p className="text-sm text-neutral">
              中止すると、申込済み・補欠の方全員にお知らせが届き、以後の新規申込を
              締め切ります。支払い済みの参加者は管理コンソールに「要返金」として
              表示されます。あとから取り消すこともできます。
            </p>
            <form method="post" action={`/events/${event.id}/cancel`} className="mt-3 space-y-3">
              <label className="block">
                <span className="text-sm font-bold">中止の理由(参加者に表示)</span>
                <textarea
                  name="reason"
                  rows={3}
                  maxLength={500}
                  className="input mt-1 leading-relaxed"
                  placeholder="例: 会場の都合により中止となりました。振替日は決まり次第お知らせします。"
                />
              </label>
              <label className="block text-sm">
                確認のため <span className="font-bold">中止</span> と入力してください
                <input type="text" name="confirm" autoComplete="off" className="input mt-1 max-w-xs" />
              </label>
              <button
                type="submit"
                className="min-h-11 cursor-pointer border-2 border-accent px-4 font-bold text-accent hover:bg-accent hover:text-paper"
              >
                このイベントを中止する
              </button>
            </form>
          </div>
        </details>
      )}

      {event.cancelledAt && (
        <div className="mt-6 border-2 border-accent bg-paper-2 p-4">
          <p className="display t-md text-accent">このイベントは中止されました</p>
          {event.cancelReason && (
            <p className="mt-2 text-sm leading-relaxed">{event.cancelReason}</p>
          )}
          <p className="mt-2 text-sm text-neutral">
            中止日時: {FULL_FMT.format(event.cancelledAt)}
            {' '}· お支払い済みの場合の返金は主催者にお問い合わせください。
          </p>
          {canEdit && (
            <form method="post" action={`/events/${event.id}/uncancel`} className="mt-3">
              <button type="submit" className="btn-quiet cursor-pointer">
                中止を取り消す(再開)
              </button>
            </form>
          )}
        </div>
      )}

      {/* ---- 限定公開の案内(主催メンバー向け)---- */}
      {canEdit && event.visibility === 'unlisted' && (
        <div className="mt-6 border-2 border-accent-2 bg-paper-2 p-4">
          <p className="font-bold text-accent-2">これは限定公開です</p>
          <p className="mt-1 text-sm text-neutral">
            下の共有リンクを知っている人だけが閲覧・申込できます。一覧・検索・
            Fediverse 告知には出ません。誰でも見つけられるようにするには公開してください。
          </p>
          <form method="post" action={`/events/${event.id}/publish`} className="mt-3">
            <button type="submit" className="btn cursor-pointer">
              公開に切り替える
            </button>
          </form>
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
            {event.totalCapacity != null && (
              <p className="border-b border-rule p-3 text-sm text-neutral">
                合計定員 {event.totalCapacity} 名
                {(() => {
                  const held = [...slotStats.values()].reduce((n, s) => n + s.accepted, 0);
                  return held >= event.totalCapacity! ? (
                    <span className="ml-2 font-bold text-accent">— 満員(以降は補欠)</span>
                  ) : (
                    <span className="ml-1">(現在 {held} 名)</span>
                  );
                })()}
              </p>
            )}
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
                                  ({slot.paymentMethod === 'onsite' ? '現地払い' : slot.paymentMethod === 'stripe' ? 'カード決済' : '事前決済'})
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
                          <SlotConditionBadges conditions={slot.conditions} />
                          {/* 抽選日時が無いと cron が拾わず、申込者が抽選待ちのまま止まる */}
                          {canEdit && slot.method === 'lottery' && !slot.lotteryAt && (
                            <p
                              role="alert"
                              className="mt-1 border-2 border-accent p-2 text-sm text-accent"
                            >
                              抽選日時が未設定です。このままでは自動抽選が実行されず、
                              申込者は「抽選待ち」のままになります。枠を編集して抽選日時を設定するか、
                              管理コンソールから手動で抽選を実行してください
                            </p>
                          )}
                          {canEdit && (
                            <Link
                              to={`/g/${handle}/events/${eventId}/slots/${slot.id}/edit`}
                              className="link mt-1 inline-block text-sm"
                            >
                              この枠を編集
                            </Link>
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
                      {isViewable(event.visibility) && (
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
                                (slot.paymentMethod === 'stripe' && own.paymentId ? (
                                  <form
                                    method="post"
                                    action={`/payments/${own.paymentId}/checkout`}
                                  >
                                    <button type="submit" className="btn cursor-pointer">
                                      カードで支払う
                                    </button>
                                  </form>
                                ) : slot.paymentMethod === 'external' && slot.paymentUrl ? (
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
            {isViewable(event.visibility) &&
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
                  <SlotFormFields
                    groupDiscordGuildId={groupRow?.discordGuildId}
                    stripeConnected={groupStripeConnected}
                  />
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
                  const base = p.domain
                    ? `${p.displayName} (@${p.handle}@${p.domain})`
                    : p.displayName;
                  // アイコンだけの並びなので、未確定の人は状態を添えて区別できるようにする
                  const label =
                    p.status === 'accepted' ? base : `${base} — ${STATUS_LABEL[p.status] ?? p.status}`;
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
