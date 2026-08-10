/**
 * MCP のツール定義と実装(Phase 1: 公開データの読み取り)。
 * 認証不要。公開イベント/グループの情報のみを返す。
 */
import type { Db } from '../../db/client';
import {
  getEventDetail,
  getGroupByHandle,
  listGroupEvents,
  listUpcomingEvents,
  searchUpcomingEvents,
} from '../data';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (db: Db, origin: string, args: Record<string, unknown>) => Promise<unknown>;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

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

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function intArg(v: unknown, fallback: number, max: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(str(v), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export const TOOLS: McpTool[] = [
  {
    name: 'list_upcoming_events',
    description:
      '今後開催される公開イベントを開始日時の早い順で一覧します。Yorox インスタンス全体が対象です。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: '取得件数(1〜50、既定 20)', minimum: 1, maximum: 50 },
      },
    },
    async handler(db, origin, args) {
      const rows = await listUpcomingEvents(db, intArg(args.limit, 20, 50));
      return {
        events: rows.map((e) => ({
          id: e.id,
          title: e.title,
          startsAt: iso(e.startsAt),
          venue: venueOf(e),
          group: { handle: e.groupHandle, name: e.groupName },
          url: eventUrl(origin, e.groupHandle, e.id),
        })),
      };
    },
  },
  {
    name: 'search_events',
    description: '公開イベントをキーワード(タイトルの部分一致)で検索します。今後開催分が対象です。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '検索キーワード' },
        limit: { type: 'integer', description: '取得件数(1〜50、既定 20)', minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
    async handler(db, origin, args) {
      const query = str(args.query);
      if (!query) return { events: [], note: 'query が空です' };
      const rows = await searchUpcomingEvents(db, query, intArg(args.limit, 20, 50));
      return {
        query,
        events: rows.map((e) => ({
          id: e.id,
          title: e.title,
          startsAt: iso(e.startsAt),
          venue: venueOf(e),
          group: { handle: e.groupHandle, name: e.groupName },
          url: eventUrl(origin, e.groupHandle, e.id),
        })),
      };
    },
  },
  {
    name: 'get_event',
    description:
      'イベント ID から公開イベントの詳細(日時・会場・主催・参加枠の空き・セッション)を取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'イベントの ID(ULID)' },
      },
      required: ['event_id'],
    },
    async handler(db, origin, args) {
      const id = str(args.event_id);
      const detail = await getEventDetail(db, id);
      if (!detail || detail.event.visibility !== 'public') {
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
        venue: venueOf(event),
        online: !!event.onlineUrl,
        group: { handle: groupActor?.handle ?? null, name: groupActor?.displayName ?? null },
        url: eventUrl(origin, groupActor?.handle ?? null, event.id),
        slots: slots.map((s) => {
          const stat = slotStats.get(s.id);
          const accepted = stat?.accepted ?? 0;
          return {
            id: s.id,
            name: s.name,
            method: s.method,
            capacity: s.capacity,
            accepted,
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
      properties: {
        group_handle: { type: 'string', description: 'グループのハンドル(@ は不要)' },
      },
      required: ['group_handle'],
    },
    async handler(db, origin, args) {
      const handle = str(args.group_handle).replace(/^@/, '');
      const group = await getGroupByHandle(db, handle);
      if (!group) return { error: 'not_found', message: 'グループが見つかりません' };
      const rows = await listGroupEvents(db, group.actor.id, { includeDrafts: false });
      return {
        group: { handle: group.actor.handle, name: group.actor.displayName },
        events: rows.map((e) => ({
          id: e.id,
          title: e.title,
          startsAt: iso(e.startsAt),
          url: eventUrl(origin, group.actor.handle, e.id),
        })),
      };
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
