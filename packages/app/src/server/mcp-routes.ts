/**
 * MCP(Model Context Protocol)エンドポイント。
 * 最新仕様 2026-07-28(ステートレス Streamable HTTP)に準拠しつつ、
 * 旧版(2025-06-18 の initialize ハンドシェイク)とも相互運用する dual-era 実装。
 *
 * 2026-07-28 の要点:
 * - 単一 POST エンドポイント。セッション無し(Mcp-Session-Id は無視)、GET/DELETE は 405
 * - initialize ハンドシェイク廃止。バージョンは各リクエストの _meta / MCP-Protocol-Version
 * - server/discover を必須実装
 * - 全 result に resultType:"complete"、result._meta に serverInfo(SHOULD)
 * - tools/list は CacheableResult(ttlMs / cacheScope)
 * - 未知メソッドは 404 + -32601、バージョン不一致は 400(-32020 / -32022)
 * - Origin 検証(不正な Origin は 403)
 */
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb } from '../db/client';
import { resolveActorByToken } from '../domain/access-token';
import { getSlotCoordinator } from './coordinator';
import { requestOrigin } from './http';
import { TOOLS, TOOLS_BY_NAME } from './mcp/tools';

const SUPPORTED_VERSIONS = ['2026-07-28', '2025-06-18', '2025-03-26'];
const LATEST_VERSION = '2026-07-28';
const SERVER_INFO = { name: 'Yorox', title: 'Yorox', version: '1.0.0' };
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_SERVERINFO = 'io.modelcontextprotocol/serverInfo';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

type JsonRpcId = string | number | null;
interface JsonRpcMessage {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}
interface RpcOut {
  status: number;
  body: unknown;
}

/** 成功 result(2026-07-28: resultType + _meta.serverInfo を付与) */
function ok(id: JsonRpcId, result: Record<string, unknown>): RpcOut {
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id,
      result: { resultType: 'complete', _meta: { [META_SERVERINFO]: SERVER_INFO }, ...result },
    },
  };
}
function err(id: JsonRpcId, status: number, code: number, message: string, data?: unknown): RpcOut {
  return {
    status,
    body: { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } },
  };
}

/** Mcp-Name 等の base64 sentinel(=?base64?...?=)をデコード */
function decodeHeaderValue(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = /^=\?base64\?(.*)\?=$/.exec(v);
  if (!m) return v;
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(m[1]!), (ch) => ch.charCodeAt(0)));
  } catch {
    return v;
  }
}

/** DNS リバインディング対策。Origin があってホスト不一致なら不許可 */
function originAllowed(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

async function dispatch(c: Context, msg: JsonRpcMessage): Promise<RpcOut> {
  const id = msg.id ?? null;
  const method = msg.method ?? '';
  const params = msg.params ?? {};
  const meta = (params._meta ?? {}) as Record<string, unknown>;

  // --- バージョン検証(宣言があるときのみ)---
  const headerVer = c.req.header('mcp-protocol-version');
  const metaVer = typeof meta[META_VERSION] === 'string' ? (meta[META_VERSION] as string) : undefined;
  if (headerVer && metaVer && headerVer !== metaVer) {
    return err(id, 400, -32020, `Header mismatch: MCP-Protocol-Version (${headerVer}) != _meta (${metaVer})`);
  }
  const declaredVer = metaVer ?? headerVer;
  if (declaredVer && !SUPPORTED_VERSIONS.includes(declaredVer)) {
    return err(id, 400, -32022, 'Unsupported protocol version', {
      supported: SUPPORTED_VERSIONS,
      requested: declaredVer,
    });
  }

  // --- ヘッダ↔ボディ整合(ヘッダがあるときのみ検証)---
  const mcpMethod = c.req.header('mcp-method');
  if (mcpMethod && mcpMethod !== method) {
    return err(id, 400, -32020, `Header mismatch: Mcp-Method (${mcpMethod}) != body (${method})`);
  }

  switch (method) {
    case 'server/discover':
      return ok(id, {
        protocolVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'Yorox の公開イベント/グループを検索・取得し、認証時は作成・参加もできます。',
      });

    // 旧版クライアント互換(legacy initialize)
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : '2025-06-18';
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Yorox の公開イベント/グループを検索・取得し、認証時は作成・参加もできます。',
      });
    }

    case 'tools/list':
      // CacheableResult: ツール一覧はほぼ不変なので長めの ttl・public
      return ok(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        ttlMs: 3_600_000,
        cacheScope: 'public',
      });

    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      const mcpName = decodeHeaderValue(c.req.header('mcp-name'));
      if (mcpName && mcpName !== name) {
        return err(id, 400, -32020, `Header mismatch: Mcp-Name (${mcpName}) != body (${name})`);
      }
      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) return err(id, 404, -32601, `Unknown tool: ${name}`);
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const db = createDb((await getEnv()).DB);
      const origin = await requestOrigin(c);

      const auth = c.req.header('authorization') ?? '';
      const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined;
      const actorId = await resolveActorByToken(db, token);
      if (tool.requiresAuth && !actorId) {
        return ok(id, {
          content: [
            {
              type: 'text',
              text: 'このツールには認証が必要です。Yorox の設定でアクセストークンを発行し、Authorization: Bearer <token> を設定してください。',
            },
          ],
          isError: true,
        });
      }
      const slotCoordinator = await getSlotCoordinator();
      try {
        const data = await tool.handler({ db, origin, actorId, slotCoordinator }, args);
        const isError = !!(data && typeof data === 'object' && 'error' in data);
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
          isError,
        });
      } catch (e) {
        return ok(id, {
          content: [{ type: 'text', text: `ツール実行エラー: ${String(e)}` }],
          isError: true,
        });
      }
    }

    // 2026-07-28 で削除された ping は互換のため no-op で受ける
    case 'ping':
      return ok(id, {});

    default:
      // 未知メソッドは 404 + -32601(旧 HTTP+SSE の 404 と区別するため JSON-RPC error を返す)
      return err(id, 404, -32601, `Method not found: ${method}`);
  }
}

const mcp = new Hono();

mcp.post('/mcp', async (c) => {
  if (!originAllowed(c)) return c.text('forbidden', 403);

  let msg: JsonRpcMessage;
  try {
    msg = (await c.req.json()) as JsonRpcMessage;
  } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  if (Array.isArray(msg)) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch requests are not supported' } }, 400);
  }

  // notification(id 無し)は 202 Accepted(body 無し)
  const isRequest = msg.method !== undefined && msg.id !== undefined && msg.id !== null;
  if (!isRequest) return c.body(null, 202);

  const out = await dispatch(c, msg);
  return c.json(out.body, out.status as 200);
});

// セッション/SSE 未対応(Mcp-Session-Id・Last-Event-ID は無視)
mcp.get('/mcp', (c) => c.text('Method Not Allowed', 405));
mcp.delete('/mcp', (c) => c.text('Method Not Allowed', 405));

export default function mcpRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', mcp);
  return (_c, next) => next();
}
