/**
 * 主催者向け管理操作と、参加者本人の操作(承諾応答・一覧非表示)のエンドポイント。
 */
import { and, eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb, schema } from '../db/client';
import {
  decideParticipation,
  recordAttendance,
  respondToPromotion,
  runLottery,
} from '../domain/participation';
import { markPayment } from '../domain/payment';
import { ulid } from '../lib/ulid';
import type { Permission } from '../domain/permissions';
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

/** datetime-local の値を JST として解釈する(MVP は Asia/Tokyo 固定) */
function parseLocalDateTime(v: unknown): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(`${s}:00+09:00`);
  return Number.isNaN(t) ? undefined : new Date(t);
}

type Db = ReturnType<typeof createDb>;

/** participation → 所属イベント・グループを解決して権限チェック */
async function authorizeForParticipation(
  db: Db,
  participationId: string,
  actorId: string,
  permission: Permission,
): Promise<{ eventId: string; handle: string; groupActorId: string } | null> {
  const participation = await db.query.participations.findFirst({
    where: eq(schema.participations.id, participationId),
  });
  if (!participation) return null;
  const slot = await db.query.slots.findFirst({
    where: eq(schema.slots.id, participation.slotId),
  });
  if (!slot) return null;
  return authorizeForEvent(db, slot.eventId, actorId, permission);
}

async function authorizeForEvent(
  db: Db,
  eventId: string,
  actorId: string,
  permission: Permission,
): Promise<{ eventId: string; handle: string; groupActorId: string } | null> {
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
  if (!event) return null;
  const groupActor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, event.groupActorId),
  });
  if (!groupActor?.handle) return null;
  const allowed = await hasGroupPermission(db, event.groupActorId, actorId, permission);
  return allowed ? { eventId: event.id, handle: groupActor.handle, groupActorId: event.groupActorId } : null;
}

const manage = new Hono();

/** 抽選の実行(random / weighted) */
manage.post('/slots/:id/lottery/run', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const slot = await db.query.slots.findFirst({
    where: eq(schema.slots.id, c.req.param('id')),
  });
  if (!slot) return c.notFound();
  const ctx = await authorizeForEvent(db, slot.eventId, actorId, 'lottery.run');
  if (!ctx) return c.text('権限がありません', 403);

  try {
    await runLottery(db, slot.id);
  } catch (err) {
    return c.redirect(
      `/g/${ctx.handle}/events/${ctx.eventId}/manage?error=${encodeURIComponent(String(err instanceof Error ? err.message : err))}`,
      302,
    );
  }
  return c.redirect(`/g/${ctx.handle}/events/${ctx.eventId}/manage`, 302);
});

/** 手動判定(当選/補欠/落選) */
manage.post('/participations/:id/decide', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await authorizeForParticipation(db, c.req.param('id'), actorId, 'lottery.run');
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const decision = str(form.decision);
  if (decision !== 'accepted' && decision !== 'waitlisted' && decision !== 'rejected') {
    return c.text('invalid decision', 400);
  }
  await decideParticipation(db, c.req.param('id'), decision);
  return c.redirect(`/g/${ctx.handle}/events/${ctx.eventId}/manage`, 302);
});

/** 出欠記録 */
manage.post('/participations/:id/attendance', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await authorizeForParticipation(
    db,
    c.req.param('id'),
    actorId,
    'attendance.manage',
  );
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const status = str(form.status);
  if (status !== 'attended' && status !== 'no_show') return c.text('invalid status', 400);

  await recordAttendance(db, {
    participationId: c.req.param('id'),
    status,
    recordedByActorId: actorId,
  });
  return c.redirect(`/g/${ctx.handle}/events/${ctx.eventId}/manage`, 302);
});

/** 参加者一覧の表示/非表示(本人のオプトアウト) */
manage.post('/participations/:id/visibility', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const participation = await db.query.participations.findFirst({
    where: eq(schema.participations.id, c.req.param('id')),
  });
  if (!participation || participation.actorId !== actorId) return c.notFound();

  const form = await c.req.parseBody();
  await db
    .update(schema.participations)
    .set({ hiddenFromList: str(form.hidden) === '1' })
    .where(eq(schema.participations.id, participation.id));

  const slot = await db.query.slots.findFirst({
    where: eq(schema.slots.id, participation.slotId),
  });
  const event = slot
    ? await db.query.events.findFirst({ where: eq(schema.events.id, slot.eventId) })
    : null;
  const groupActor = event
    ? await db.query.actors.findFirst({ where: eq(schema.actors.id, event.groupActorId) })
    : null;
  return c.redirect(
    event && groupActor?.handle ? `/g/${groupActor.handle}/events/${event.id}` : '/',
    302,
  );
});

/** 支払い状態の変更(支払済み/返金済み/免除) */
manage.post('/payments/:id/mark', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const payment = await db.query.payments.findFirst({
    where: eq(schema.payments.id, c.req.param('id')),
  });
  if (!payment) return c.notFound();
  const ctx = await authorizeForParticipation(
    db,
    payment.participationId,
    actorId,
    'attendance.manage',
  );
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const status = str(form.status);
  if (
    status !== 'paid' &&
    status !== 'refunded' &&
    status !== 'no_refund' &&
    status !== 'waived'
  ) {
    return c.text('invalid status', 400);
  }

  // Stripe 枠の「返金する」は実際に Stripe で返金してからマークする
  if (status === 'refunded' && payment.method === 'stripe' && payment.providerRef) {
    const env = await getEnv();
    const { stripeConfigured, createRefund } = await import('../lib/stripe');
    if (stripeConfigured(env)) {
      const group = await db.query.groups.findFirst({
        where: eq(schema.groups.actorId, ctx.groupActorId),
      });
      if (group?.stripeAccountId) {
        const refund = await createRefund(env, {
          stripeAccount: group.stripeAccountId,
          paymentIntent: payment.providerRef,
        });
        if (!refund) {
          return c.redirect(
            `/g/${ctx.handle}/events/${ctx.eventId}/manage?error=${encodeURIComponent('Stripe での返金に失敗しました。Stripe ダッシュボードをご確認ください。')}`,
            302,
          );
        }
      }
    }
  }

  await markPayment(db, payment.id, status, actorId);
  return c.redirect(`/g/${ctx.handle}/events/${ctx.eventId}/manage`, 302);
});

/** 承諾型繰上への応答(本人) */
manage.post('/action-requests/:id/respond', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const request = await db.query.actionRequests.findFirst({
    where: eq(schema.actionRequests.id, c.req.param('id')),
  });
  if (!request || request.actorId !== actorId) return c.notFound();

  const form = await c.req.parseBody();
  await respondToPromotion(db, {
    actionRequestId: request.id,
    accept: str(form.accept) === '1',
  });
  return c.redirect('/requests', 302);
});

/** セッション追加 */
manage.post('/events/:id/sessions', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await authorizeForEvent(db, c.req.param('id'), actorId, 'event.edit');
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const title = str(form.title);
  if (!title) {
    return c.redirect(`/g/${ctx.handle}/events/${ctx.eventId}/manage?error=session_invalid`, 302);
  }
  const existing = await db.query.eventSessions.findMany({
    where: eq(schema.eventSessions.eventId, ctx.eventId),
  });
  await db.insert(schema.eventSessions).values({
    id: ulid(),
    eventId: ctx.eventId,
    title,
    descriptionMd: str(form.description_md) || null,
    speakerName: str(form.speaker_name) || null,
    speakerUrl: /^https?:\/\//.test(str(form.speaker_url)) ? str(form.speaker_url) : null,
    startsAt: parseLocalDateTime(form.starts_at) ?? null,
    endsAt: parseLocalDateTime(form.ends_at) ?? null,
    sortOrder: existing.length,
  });
  return c.redirect(`/g/${ctx.handle}/events/${ctx.eventId}/manage`, 302);
});

/** セッション削除 */
manage.post('/sessions/:id/delete', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const session = await db.query.eventSessions.findFirst({
    where: eq(schema.eventSessions.id, c.req.param('id')),
  });
  if (!session) return c.notFound();
  const ctx = await authorizeForEvent(db, session.eventId, actorId, 'event.edit');
  if (!ctx) return c.text('権限がありません', 403);

  // セッション配下の資料はイベント直下へ付け替えてから消す
  await db
    .update(schema.materials)
    .set({ sessionId: null })
    .where(eq(schema.materials.sessionId, session.id));
  await db.delete(schema.eventSessions).where(eq(schema.eventSessions.id, session.id));
  return c.redirect(`/g/${ctx.handle}/events/${ctx.eventId}/manage`, 302);
});

/** 資料追加(外部リンク) */
manage.post('/events/:id/materials', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const ctx = await authorizeForEvent(db, c.req.param('id'), actorId, 'event.edit');
  if (!ctx) return c.text('権限がありません', 403);

  const form = await c.req.parseBody();
  const title = str(form.title);
  const url = str(form.url);
  if (!title || !/^https?:\/\//.test(url)) {
    return c.redirect(`/g/${ctx.handle}/events/${ctx.eventId}/manage?error=material_invalid`, 302);
  }
  const sessionId = str(form.session_id);
  await db.insert(schema.materials).values({
    id: ulid(),
    eventId: ctx.eventId,
    sessionId: sessionId || null,
    title,
    url,
    createdByActorId: actorId,
    createdAt: new Date(),
  });
  return c.redirect(`/g/${ctx.handle}/events/${ctx.eventId}/manage`, 302);
});

/** 資料削除 */
manage.post('/materials/:id/delete', async (c) => {
  if (!assertSameOrigin(c)) return c.text('forbidden', 403);
  const db = createDb((await getEnv()).DB);
  const actorId = await getSessionActorId(db, c);
  if (!actorId) return c.redirect('/login', 302);

  const material = await db.query.materials.findFirst({
    where: eq(schema.materials.id, c.req.param('id')),
  });
  if (!material) return c.notFound();
  const ctx = await authorizeForEvent(db, material.eventId, actorId, 'event.edit');
  if (!ctx) return c.text('権限がありません', 403);

  await db.delete(schema.materials).where(eq(schema.materials.id, material.id));
  return c.redirect(`/g/${ctx.handle}/events/${ctx.eventId}/manage`, 302);
});

export default function manageRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', manage);
  return (_c, next) => next();
}
