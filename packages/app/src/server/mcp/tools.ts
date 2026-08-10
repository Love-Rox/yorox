/**
 * MCP のツール定義と実装。
 * - 読み取り(認証不要): 公開イベント/グループの情報
 * - 書き込み(要 PAT 認証): イベント作成・参加・キャンセル・自分の参加状況
 * 認証は ctx.actorId(Bearer PAT から解決)で判定する。
 */
import { isViewable } from '../../domain/visibility';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { schema } from '../../db/client';
import { createEvent } from '../../domain/event-service';
import {
  AlreadyJoinedError,
  cancelParticipation,
  ConditionNotMetError,
  EventCancelledError,
  joinSlot,
  ReJoinBlockedError,
  SlotFullError,
  type SlotCoordinatorLike,
} from '../../domain/participation';
import { GroupBlockedError } from '../../domain/blocks';
import {
  getEventDetail,
  getGroupByHandle,
  listGroupEvents,
  listUpcomingEvents,
  searchUpcomingEvents,
} from '../data';
import { hasGroupPermission } from '../route-auth';

export interface McpContext {
  db: Db;
  origin: string;
  /** Bearer PAT から解決した本人の actorId(未認証は null) */
  actorId: string | null;
  slotCoordinator?: SlotCoordinatorLike | undefined;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresAuth?: boolean;
  handler: (ctx: McpContext, args: Record<string, unknown>) => Promise<unknown>;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
function intArg(v: unknown, fallback: number, max: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(str(v), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}
function parseDate(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

function eventUrl(origin: string, handle: string | null, id: string): string {
  return handle ? `${origin}/g/${handle}/events/${id}` : `${origin}/events/${id}`;
}
function venueOf(e: {
  venueName: string | null;
  venueAddress?: string | null;
  onlineUrl: string | null;
}): string | null {
  if (e.venueName) return e.venueAddress ? `${e.venueName}(${e.venueAddress})` : e.venueName;
  return e.onlineUrl ? 'オンライン開催' : null;
}

/** 本人 + claim 済みリモート別名の actorId 一覧 */
async function identityActorIds(db: Db, userActorId: string): Promise<string[]> {
  const aliases = await db.query.actors.findMany({
    where: eq(schema.actors.claimedByActorId, userActorId),
  });
  return [userActorId, ...aliases.map((a) => a.id)];
}

export const TOOLS: McpTool[] = [
  // ---- 読み取り(認証不要)----
  {
    name: 'list_upcoming_events',
    description: '今後開催される公開イベントを開始日時の早い順で一覧します。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: '取得件数(1〜50、既定 20)', minimum: 1, maximum: 50 },
      },
    },
    async handler(ctx, args) {
      const rows = await listUpcomingEvents(ctx.db, intArg(args.limit, 20, 50));
      return {
        events: rows.map((e) => ({
          id: e.id,
          title: e.title,
          startsAt: iso(e.startsAt),
          venue: venueOf(e),
          group: { handle: e.groupHandle, name: e.groupName },
          url: eventUrl(ctx.origin, e.groupHandle, e.id),
        })),
      };
    },
  },
  {
    name: 'search_events',
    description: '公開イベントをキーワード(タイトルの部分一致)で検索します。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '検索キーワード' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
    async handler(ctx, args) {
      const query = str(args.query);
      if (!query) return { events: [] };
      const rows = await searchUpcomingEvents(ctx.db, query, intArg(args.limit, 20, 50));
      return {
        query,
        events: rows.map((e) => ({
          id: e.id,
          title: e.title,
          startsAt: iso(e.startsAt),
          venue: venueOf(e),
          group: { handle: e.groupHandle, name: e.groupName },
          url: eventUrl(ctx.origin, e.groupHandle, e.id),
        })),
      };
    },
  },
  {
    name: 'get_event',
    description: 'イベント ID から公開イベントの詳細(日時・会場・主催・参加枠の空き・セッション)を取得します。',
    inputSchema: {
      type: 'object',
      properties: { event_id: { type: 'string', description: 'イベントの ID(ULID)' } },
      required: ['event_id'],
    },
    async handler(ctx, args) {
      const detail = await getEventDetail(ctx.db, str(args.event_id));
      if (!detail || !isViewable(detail.event.visibility)) {
        return { error: 'not_found', message: '公開イベントが見つかりません' };
      }
      const { event, groupActor, slots, slotStats, sessions } = detail;
      return {
        id: event.id,
        title: event.title,
        description: event.descriptionMd ?? null,
        startsAt: iso(event.startsAt),
        endsAt: iso(event.endsAt),
        timezone: event.timezone,
        cancelled: !!event.cancelledAt,
        cancelReason: event.cancelReason ?? null,
        venue: venueOf(event),
        online: !!event.onlineUrl,
        group: { handle: groupActor?.handle ?? null, name: groupActor?.displayName ?? null },
        url: eventUrl(ctx.origin, groupActor?.handle ?? null, event.id),
        slots: slots.map((s) => {
          const accepted = slotStats.get(s.id)?.accepted ?? 0;
          return {
            id: s.id,
            name: s.name,
            method: s.method,
            capacity: s.capacity,
            remaining: Math.max(0, s.capacity - accepted),
            price: s.price ?? null,
            currency: s.price ? s.currency : null,
          };
        }),
        sessions: sessions.map((s) => ({
          title: s.title,
          speaker: s.speakerName ?? null,
          startsAt: iso(s.startsAt),
        })),
      };
    },
  },
  {
    name: 'list_group_events',
    description: 'グループのハンドルから、そのグループの公開イベント一覧を取得します。',
    inputSchema: {
      type: 'object',
      properties: { group_handle: { type: 'string', description: 'グループのハンドル(@ 不要)' } },
      required: ['group_handle'],
    },
    async handler(ctx, args) {
      const group = await getGroupByHandle(ctx.db, str(args.group_handle).replace(/^@/, ''));
      if (!group) return { error: 'not_found', message: 'グループが見つかりません' };
      const rows = await listGroupEvents(ctx.db, group.actor.id, { includeDrafts: false });
      return {
        group: { handle: group.actor.handle, name: group.actor.displayName },
        events: rows.map((e) => ({
          id: e.id,
          title: e.title,
          startsAt: iso(e.startsAt),
          url: eventUrl(ctx.origin, group.actor.handle, e.id),
        })),
      };
    },
  },

  // ---- 書き込み(要 PAT 認証)----
  {
    name: 'list_my_participations',
    description: '自分が申込・参加しているイベントの一覧と状態を返します(要認証)。',
    requiresAuth: true,
    inputSchema: { type: 'object', properties: {} },
    async handler(ctx) {
      const ids = await identityActorIds(ctx.db, ctx.actorId!);
      const rows = await ctx.db
        .select({
          participationId: schema.participations.id,
          status: schema.participations.status,
          slotName: schema.slots.name,
          eventId: schema.events.id,
          eventTitle: schema.events.title,
          startsAt: schema.events.startsAt,
          groupHandle: schema.actors.handle,
        })
        .from(schema.participations)
        .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
        .innerJoin(schema.events, eq(schema.slots.eventId, schema.events.id))
        .innerJoin(schema.actors, eq(schema.events.groupActorId, schema.actors.id))
        .where(inArray(schema.participations.actorId, ids));
      return {
        participations: rows.map((r) => ({
          participationId: r.participationId,
          status: r.status,
          slot: r.slotName,
          event: { id: r.eventId, title: r.eventTitle, startsAt: iso(r.startsAt) },
          url: eventUrl(ctx.origin, r.groupHandle, r.eventId),
        })),
      };
    },
  },
  {
    name: 'create_event',
    description:
      '自分が event.create 権限を持つグループに、下書きイベントを作成します(要認証)。公開は Web の管理画面から行ってください。',
    requiresAuth: true,
    inputSchema: {
      type: 'object',
      properties: {
        group_handle: { type: 'string', description: '主催グループのハンドル(自分の個人グループ等)' },
        title: { type: 'string', description: 'イベントタイトル' },
        starts_at: { type: 'string', description: '開始日時(ISO 8601、例 2026-09-01T19:00:00+09:00)' },
        ends_at: { type: 'string', description: '終了日時(ISO 8601、任意)' },
        description: { type: 'string', description: '本文(Markdown、任意)' },
        venue_name: { type: 'string', description: '会場名(任意)' },
        online_url: { type: 'string', description: 'オンライン URL(任意)' },
      },
      required: ['group_handle', 'title', 'starts_at'],
    },
    async handler(ctx, args) {
      const group = await getGroupByHandle(ctx.db, str(args.group_handle).replace(/^@/, ''));
      if (!group) return { error: 'not_found', message: 'グループが見つかりません' };
      if (!(await hasGroupPermission(ctx.db, group.actor.id, ctx.actorId!, 'event.create'))) {
        return { error: 'forbidden', message: 'このグループでイベントを作成する権限がありません' };
      }
      const title = str(args.title);
      const startsAt = parseDate(args.starts_at);
      if (!title) return { error: 'invalid', message: 'title は必須です' };
      if (!startsAt) return { error: 'invalid', message: 'starts_at は ISO 8601 形式で指定してください' };
      const { eventId } = await createEvent(ctx.db, {
        groupActorId: group.actor.id,
        title,
        descriptionMd: str(args.description) || undefined,
        startsAt,
        endsAt: parseDate(args.ends_at) ?? undefined,
        venueName: str(args.venue_name) || undefined,
        onlineUrl: str(args.online_url) || undefined,
        createdByActorId: ctx.actorId!,
      });
      return {
        id: eventId,
        status: 'draft',
        editUrl: `${ctx.origin}/g/${group.actor.handle}/events/${eventId}/edit`,
        message: '下書きを作成しました。参加枠の設定と公開は編集画面から行ってください。',
      };
    },
  },
  {
    name: 'join_slot',
    description: 'イベントの参加枠に申し込みます(要認証)。結果は accepted / waitlisted / applied のいずれか。',
    requiresAuth: true,
    inputSchema: {
      type: 'object',
      properties: { slot_id: { type: 'string', description: '参加枠の ID(get_event の slots[].id)' } },
      required: ['slot_id'],
    },
    async handler(ctx, args) {
      const slotId = str(args.slot_id);
      if (!slotId) return { error: 'invalid', message: 'slot_id は必須です' };
      try {
        const result = await joinSlot(
          ctx.db,
          { slotId, actorId: ctx.actorId! },
          ctx.slotCoordinator ? { slotCoordinator: ctx.slotCoordinator } : {},
        );
        return { participationId: result.participationId, status: result.status };
      } catch (err) {
        if (err instanceof SlotFullError) return { error: 'full', message: 'この枠は満席です' };
        if (err instanceof AlreadyJoinedError)
          return { error: 'already', message: 'この枠には既に申し込み済みです' };
        if (err instanceof ConditionNotMetError)
          return { error: 'condition', message: err.reason };
        if (err instanceof GroupBlockedError)
          return { error: 'blocked', message: 'このグループのイベントには参加できません' };
        if (err instanceof EventCancelledError)
          return { error: 'event_cancelled', message: 'このイベントは中止されました' };
        if (err instanceof ReJoinBlockedError) return { error: 'rejoin_blocked', message: err.message };
        throw err;
      }
    },
  },
  {
    name: 'cancel_participation',
    description: '自分の参加(申込)をキャンセルします(要認証)。',
    requiresAuth: true,
    inputSchema: {
      type: 'object',
      properties: {
        participation_id: { type: 'string', description: '参加の ID(list_my_participations の participationId)' },
      },
      required: ['participation_id'],
    },
    async handler(ctx, args) {
      const pid = str(args.participation_id);
      const ids = await identityActorIds(ctx.db, ctx.actorId!);
      const part = await ctx.db.query.participations.findFirst({
        where: and(
          eq(schema.participations.id, pid),
          inArray(schema.participations.actorId, ids),
        ),
      });
      if (!part) return { error: 'not_found', message: '自分の参加が見つかりません' };
      await cancelParticipation(ctx.db, pid);
      return { ok: true, participationId: pid, status: 'cancelled' };
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
