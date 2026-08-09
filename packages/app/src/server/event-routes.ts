/**
 * イベント作成・公開・枠追加・申込・キャンセルの HTTP エンドポイント。
 * フォーム POST(SameSite=Lax cookie + Origin 検証)で受ける。
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb, schema } from '../db/client';
import { addSlot, createEvent, publishEvent, updateEvent } from '../domain/event-service';
import {
  AlreadyJoinedError,
  cancelParticipation,
  ConditionNotMetError,
  joinSlot,
  SlotFullError,
} from '../domain/participation';
import type { SlotConditions } from '../db/schema';
import { deferWork } from '../lib/defer';
import { geocodeAddress } from '../lib/geocode';
import { generateToken } from '../lib/token';
import { announceEventNow, announceEventUpdateNow } from './ap-delivery';
import { enqueueMail } from '../mail/queue';
import { getSlotCoordinator } from './coordinator';
import { sendReplyNote } from './remote-join';
import { listManageParticipations } from './data';
import { getSessionActorId, hasGroupPermission } from './route-auth';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

function assertSameOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  return origin === new URL(c.req.url).origin;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function optionalInt(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * datetime-local の値をイベントのタイムゾーンとして解釈する。
 * MVP は Asia/Tokyo 固定(+09:00)。他 TZ 対応時はここを差し替える。
 */
function parseLocalDateTime(v: unknown): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(`${s}:00+09:00`);
  return Number.isNaN(t) ? undefined : new Date(t);
}

const events = new Hono();

/** イベント作成(下書き) */
events.post('/g/:handle/events', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);

  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const handle = c.req.param('handle');
  const groupActor = await db.query.actors.findFirst({
    where: and(
      eq(schema.actors.handle, handle),
      isNull(schema.actors.domain),
      eq(schema.actors.kind, 'group'),
    ),
  });
  if (!groupActor) return c.notFound();
  if (!(await hasGroupPermission(db, groupActor.id, actorId, 'event.create'))) {
    return c.text('このグループでイベントを作成する権限がありません', 403);
  }

  const form = await c.req.parseBody();
  const startsAt = parseLocalDateTime(form.starts_at);
  if (!str(form.title) || !startsAt) {
    return c.redirect(`/g/${handle}/events/new?error=invalid_input`, 302);
  }

  try {
    // 住所があれば保存時に一度だけジオコーディングする(地図表示用)
    const venueAddress = str(form.venue_address);
    const geo = venueAddress ? await geocodeAddress(venueAddress) : null;
    const { eventId } = await createEvent(db, {
      groupActorId: groupActor.id,
      title: str(form.title),
      descriptionMd: str(form.description_md) || undefined,
      participantInfoMd: str(form.participant_info_md) || undefined,
      thumbnailUrl: str(form.thumbnail_url) || undefined,
      startsAt,
      endsAt: parseLocalDateTime(form.ends_at),
      venueName: str(form.venue_name) || undefined,
      venueAddress: venueAddress || undefined,
      venueLat: geo?.lat,
      venueLng: geo?.lng,
      onlineUrl: str(form.online_url) || undefined,
      remoteJoinMethods: parseRemoteJoinMethods(form),
      createdByActorId: actorId,
    });
    return c.redirect(`/g/${handle}/events/${eventId}`, 302);
  } catch {
    return c.redirect(`/g/${handle}/events/new?error=invalid_input`, 302);
  }
});


/** チェックボックス群から remoteJoinMethods を組み立てる */
function parseRemoteJoinMethods(form: Record<string, unknown>): ('reply' | 'join')[] {
  const methods: ('reply' | 'join')[] = [];
  if (form.remote_join_reply !== undefined) methods.push('reply');
  if (form.remote_join_activity !== undefined) methods.push('join');
  return methods;
}

/** ドメイン共通: イベントに対する編集権限チェック */
async function canEditEvent(
  db: ReturnType<typeof createDb>,
  eventId: string,
  actorId: string,
): Promise<{ event: typeof schema.events.$inferSelect; handle: string } | null> {
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
  if (!event) return null;
  const groupActor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  if (!groupActor?.handle) return null;
  const allowed = await hasGroupPermission(db, event.groupActorId, actorId, 'event.edit');
  return allowed ? { event, handle: groupActor.handle } : null;
}

/** 基本情報の更新 */
events.post('/events/:id/update', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await canEditEvent(db, c.req.param('id'), actorId);
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const startsAt = parseLocalDateTime(form.starts_at);
  const editUrl = `/g/${ctx.handle}/events/${ctx.event.id}/edit`;
  if (!str(form.title) || !startsAt) {
    return c.redirect(`${editUrl}?error=invalid_input`, 302);
  }

  try {
    // 住所が変わったときだけ再ジオコーディング(同一なら既存座標を維持)
    const venueAddress = str(form.venue_address);
    const geo =
      venueAddress && venueAddress !== (ctx.event.venueAddress ?? '')
        ? await geocodeAddress(venueAddress)
        : venueAddress
          ? { lat: ctx.event.venueLat ?? undefined, lng: ctx.event.venueLng ?? undefined }
          : null;
    await updateEvent(db, ctx.event.id, {
      title: str(form.title),
      descriptionMd: str(form.description_md) || undefined,
      participantInfoMd: str(form.participant_info_md) || undefined,
      thumbnailUrl: str(form.thumbnail_url) || undefined,
      startsAt,
      endsAt: parseLocalDateTime(form.ends_at),
      venueName: str(form.venue_name) || undefined,
      venueAddress: venueAddress || undefined,
      venueLat: geo?.lat ?? undefined,
      venueLng: geo?.lng ?? undefined,
      onlineUrl: str(form.online_url) || undefined,
      sessionsLabel: str(form.sessions_label) === 'timetable' ? 'timetable' : 'sessions',
      remoteJoinMethods: parseRemoteJoinMethods(form),
    });
    // 公開済みイベントの変更はフォロワーへ Update(Note) で通知
    if (ctx.event.visibility === 'public') {
      deferWork(c, announceEventUpdateNow(db, ctx.event.id));
    }
    return c.redirect(`/g/${ctx.handle}/events/${ctx.event.id}`, 302);
  } catch {
    return c.redirect(`${editUrl}?error=invalid_input`, 302);
  }
});



const CSV_STATUS_LABEL: Record<string, string> = {
  applied: '抽選待ち',
  accepted: '参加確定',
  payment_pending: '支払い待ち',
  waitlisted: '補欠',
  consent_pending: '繰上承諾待ち',
  rejected: '落選',
  cancelled: 'キャンセル済み',
};
const CSV_PAYMENT_LABEL: Record<string, string> = {
  pending: '未払い',
  paid: '支払済み',
  refund_required: '要返金',
  refunded: '返金済み',
  waived: '免除',
};

function csvCell(v: string): string {
  // 数式インジェクション対策: 先頭が = + - @ の値は Excel/Calc が数式として
  // 実行しうるため、先頭にシングルクォートを付けて無害化する
  // (表示名などにリモートユーザーの任意文字列が入るため必須)
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** 表示名からカスタム絵文字ショートコードを除去する */
function stripShortcodes(name: string): string {
  const stripped = name.replace(/:[a-zA-Z0-9_+-]+:/g, '').replace(/\s+/g, ' ').trim();
  return stripped || name; // 全部絵文字だった場合は元の名前を残す
}

/**
 * 参加者 CSV エクスポート(主催向け)。
 * ?emoji=shortcode(既定: :code: のまま)| strip(ショートコード除去)
 */
events.get('/events/:id/participants.csv', async (c) => {
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, c.req.param('id')),
  });
  if (!event) return c.notFound();
  const allowed =
    (await hasGroupPermission(db, event.groupActorId, actorId, 'attendance.manage')) ||
    (await hasGroupPermission(db, event.groupActorId, actorId, 'event.edit'));
  if (!allowed) return c.text('権限がありません', 403);

  const strip = c.req.query('emoji') === 'strip';
  const slots = await db.query.slots.findMany({
    where: eq(schema.slots.eventId, event.id),
  });
  const slotName = new Map(slots.map((s) => [s.id, s.name]));
  const { rows } = await listManageParticipations(db, event.id);

  const fmt = new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  });
  const lines = ['枠,状態,表示名,ハンドル,出欠,支払い,申込日時'];
  for (const r of rows) {
    const name = strip ? stripShortcodes(r.displayName) : r.displayName;
    const handle = r.handle ? (r.domain ? `@${r.handle}@${r.domain}` : `@${r.handle}`) : '';
    const attendance =
      r.attendanceStatus === 'attended' ? '出席' : r.attendanceStatus === 'no_show' ? '無断欠席' : '';
    const payment = r.paymentStatus ? (CSV_PAYMENT_LABEL[r.paymentStatus] ?? r.paymentStatus) : '';
    lines.push(
      [
        slotName.get(r.slotId) ?? '',
        CSV_STATUS_LABEL[r.status] ?? r.status,
        name,
        handle,
        attendance,
        payment,
        fmt.format(r.appliedAt),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // BOM 付き UTF-8(Excel 互換)
  const body = '\uFEFF' + lines.join('\r\n') + '\r\n';
  return c.body(body, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="participants-${event.id}${strip ? '-plain' : ''}.csv"`,
  });
});


/** 予約公開の設定 */
events.post('/events/:id/schedule-publish', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await canEditEvent(db, c.req.param('id'), actorId);
  if (!ctx) return c.text('権限がありません', 403);
  const eventUrl = `/g/${ctx.handle}/events/${ctx.event.id}`;
  if (ctx.event.visibility !== 'draft') return c.redirect(eventUrl, 302);

  const form = await c.req.parseBody();
  const publishAt = parseLocalDateTime(form.publish_at);
  if (!publishAt) {
    return c.redirect(`${eventUrl}?error=slot_invalid`, 302);
  }
  await db
    .update(schema.events)
    .set({ publishAt, updatedAt: new Date() })
    .where(eq(schema.events.id, ctx.event.id));
  return c.redirect(eventUrl, 302);
});

/** 予約公開の取消 */
events.post('/events/:id/schedule-cancel', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await canEditEvent(db, c.req.param('id'), actorId);
  if (!ctx) return c.text('権限がありません', 403);
  await db
    .update(schema.events)
    .set({ publishAt: null, updatedAt: new Date() })
    .where(eq(schema.events.id, ctx.event.id));
  return c.redirect(`/g/${ctx.handle}/events/${ctx.event.id}`, 302);
});


/**
 * 主催者から参加者へのメッセージ送信。
 * 宛先ごとに個別配送する(ローカル = メール / リモート = グループ名義の
 * ダイレクト Note)ため、参加者同士のアカウント名は互いに見えない。
 */
events.post('/events/:id/message', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, c.req.param('id')),
  });
  if (!event) return c.notFound();
  const group = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  const allowed =
    (await hasGroupPermission(db, event.groupActorId, actorId, 'attendance.manage')) ||
    (await hasGroupPermission(db, event.groupActorId, actorId, 'event.edit'));
  if (!allowed || !group?.handle) return c.text('権限がありません', 403);

  const form = await c.req.parseBody({ all: true });
  const body = str(form.body).slice(0, 2000);
  const manageUrl = `/g/${group.handle}/events/${event.id}/manage`;
  if (!body) {
    return c.redirect(`${manageUrl}?error=${encodeURIComponent('メッセージ本文を入力してください')}`, 302);
  }
  const raw = form['recipients'];
  const recipientIds = (Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [])
    .filter((v): v is string => typeof v === 'string');
  if (recipientIds.length === 0) {
    return c.redirect(`${manageUrl}?error=${encodeURIComponent('宛先を選択してください')}`, 302);
  }

  // 宛先の検証: このイベントの参加行に限る
  const slots = await db.query.slots.findMany({
    where: eq(schema.slots.eventId, event.id),
  });
  const rows = slots.length
    ? await db.query.participations.findMany({
        where: and(
          inArray(schema.participations.slotId, slots.map((sl) => sl.id)),
          inArray(schema.participations.id, recipientIds),
        ),
      })
    : [];

  let sent = 0;
  const seenActors = new Set<string>();
  for (const row of rows) {
    if (seenActors.has(row.actorId)) continue; // 複数枠の重複宛先は1通に
    seenActors.add(row.actorId);
    const recipient = await db.query.actors.findFirst({
      where: eq(schema.actors.id, row.actorId),
    });
    if (!recipient) continue;
    if (recipient.state === 'local') {
      const account = await db.query.users.findFirst({
        where: eq(schema.users.actorId, recipient.id),
      });
      if (!account) continue;
      await enqueueMail(db, {
        to: account.email,
        subject: `[Yorox] 「${event.title}」主催者からのお知らせ`,
        bodyText: `${body}\n\n--\n${event.title}\n${new URL(c.req.url).origin}/g/${group.handle}/events/${event.id}`,
      });
      sent++;
    } else if (recipient.inboxUrl || recipient.sharedInboxUrl) {
      deferWork(c, 
        sendReplyNote(db, {
          group,
          remoteActor: recipient,
          eventId: event.id,
          text: `【${event.title}】${body}`,
        }),
      );
      sent++;
    }
  }
  return c.redirect(`${manageUrl}?message_sent=${sent}`, 302);
});

/** セルフチェックイン用トークンの発行/再発行(出欠管理権限) */
events.post('/events/:id/checkin/enable', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, c.req.param('id')),
  });
  if (!event) return c.notFound();
  const group = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  const allowed = await hasGroupPermission(db, event.groupActorId, actorId, 'attendance.manage');
  if (!allowed || !group?.handle) return c.text('権限がありません', 403);

  await db
    .update(schema.events)
    .set({ checkinToken: generateToken(), updatedAt: new Date() })
    .where(eq(schema.events.id, event.id));
  return c.redirect(`/g/${group.handle}/events/${event.id}/manage`, 302);
});

/** 公開 */
events.post('/events/:id/publish', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await canEditEvent(db, c.req.param('id'), actorId);
  if (!ctx) return c.text('権限がありません', 403);

  await publishEvent(db, ctx.event.id);
  // フォロワーへの AP 告知は応答をブロックせず即時配信(失敗分は cron が再試行)
  deferWork(c, announceEventNow(db, ctx.event.id));
  return c.redirect(`/g/${ctx.handle}/events/${ctx.event.id}`, 302);
});

/** 枠追加(枠ポリシー5要素) */
events.post('/events/:id/slots', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await canEditEvent(db, c.req.param('id'), actorId);
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const eventUrl = `/g/${ctx.handle}/events/${ctx.event.id}`;

  const method = str(form.method) === 'lottery' ? 'lottery' : 'fcfs';

  // 決済設定の検証
  const price = optionalInt(form.price);
  const pm = str(form.payment_method);
  const paymentMethod =
    pm === 'onsite' ? 'onsite' : pm === 'external' ? 'external' : pm === 'stripe' ? 'stripe' : null;
  const paymentUrl = str(form.payment_url);
  if (price && price > 0) {
    if (!paymentMethod) {
      return c.redirect(`${eventUrl}?error=slot_invalid`, 302);
    }
    if (paymentMethod === 'external' && !/^https?:\/\//.test(paymentUrl)) {
      return c.redirect(`${eventUrl}?error=slot_invalid`, 302);
    }
  }

  const conditions: SlotConditions = {};
  if (form.require_claimed === 'on') conditions.requireClaimed = true;
  const minAge = optionalInt(form.min_account_age_days);
  if (minAge !== undefined && minAge > 0) conditions.minAccountAgeDays = minAge;
  const minAttended = optionalInt(form.min_attended_count);
  if (minAttended !== undefined && minAttended > 0) conditions.minAttendedCount = minAttended;

  try {
    await addSlot(db, {
      eventId: ctx.event.id,
      name: str(form.name),
      capacity: optionalInt(form.capacity) ?? 0,
      method,
      waitlistModel: str(form.waitlist_model) === 'separate' ? 'separate' : 'connpass',
      waitlistCapacity: optionalInt(form.waitlist_capacity),
      promotionPolicy:
        str(form.promotion_policy) === 'auto_deadline'
          ? 'auto_deadline'
          : str(form.promotion_policy) === 'consent'
            ? 'consent'
            : 'auto',
      promotionDeadlineHours: optionalInt(form.promotion_deadline_hours),
      lotteryLogic:
        method === 'lottery'
          ? str(form.lottery_logic) === 'manual'
            ? 'manual'
            : str(form.lottery_logic) === 'weighted'
              ? 'weighted'
              : 'random'
          : undefined,
      lotteryAt: method === 'lottery' ? parseLocalDateTime(form.lottery_at) : undefined,
      conditions: Object.keys(conditions).length > 0 ? conditions : undefined,
      allowRemote: form.allow_remote !== undefined,
      isSpeakerSlot: form.is_speaker_slot !== undefined,
      price: price && price > 0 ? price : undefined,
      paymentMethod: price && price > 0 ? (paymentMethod ?? undefined) : undefined,
      paymentUrl: paymentMethod === 'external' ? paymentUrl : undefined,
      paymentConfirm: str(form.payment_confirm) === 'required' ? 'required' : 'independent',
    });
    return c.redirect(eventUrl, 302);
  } catch {
    return c.redirect(`${eventUrl}?error=slot_invalid`, 302);
  }
});

/** 申込 */
events.post('/slots/:id/join', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const slot = await db.query.slots.findFirst({
    where: eq(schema.slots.id, c.req.param('id')),
  });
  if (!slot) return c.notFound();
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, slot.eventId),
  });
  const groupActor = event
    ? await db.query.actors.findFirst({ where: eq(schema.actors.id, event.groupActorId) })
    : null;
  if (!event || event.visibility !== 'public' || !groupActor?.handle) return c.notFound();

  const eventUrl = `/g/${groupActor.handle}/events/${event.id}`;
  try {
    const slotCoordinator = await getSlotCoordinator();
    await joinSlot(
      db,
      { slotId: slot.id, actorId },
      slotCoordinator ? { slotCoordinator } : {},
    );
    return c.redirect(eventUrl, 302);
  } catch (err) {
    if (err instanceof SlotFullError) return c.redirect(`${eventUrl}?error=full`, 302);
    if (err instanceof AlreadyJoinedError)
      return c.redirect(`${eventUrl}?error=already`, 302);
    if (err instanceof ConditionNotMetError)
      return c.redirect(`${eventUrl}?error=condition&reason=${encodeURIComponent(err.reason)}`, 302);
    throw err;
  }
});

/** キャンセル(本人のみ) */
events.post('/participations/:id/cancel', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const participation = await db.query.participations.findFirst({
    where: eq(schema.participations.id, c.req.param('id')),
  });
  if (!participation || participation.actorId !== actorId) return c.notFound();

  const slot = await db.query.slots.findFirst({
    where: eq(schema.slots.id, participation.slotId),
  });
  const event = slot
    ? await db.query.events.findFirst({ where: eq(schema.events.id, slot.eventId) })
    : null;
  const groupActor = event
    ? await db.query.actors.findFirst({ where: eq(schema.actors.id, event.groupActorId) })
    : null;

  await cancelParticipation(db, participation.id);

  const back =
    event && groupActor?.handle ? `/g/${groupActor.handle}/events/${event.id}` : '/';
  return c.redirect(back, 302);
});

export default function eventRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', events);
  return (_c, next) => next();
}
