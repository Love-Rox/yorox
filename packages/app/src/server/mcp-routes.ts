/**
 * MCP(Model Context Protocol)エンドポイント。
 * 現行仕様の Streamable HTTP をステートレスに実装する:
 * - 単一エンドポイント /mcp(POST/GET/DELETE)
 * - JSON-RPC request には application/json で単一レスポンス(SSE は使わない)
 * - notification/response 入力には 202 Accepted(body 無し)
 * - GET/DELETE は SSE/セッション未対応のため 405
 * - DNS リバインディング対策として Origin を検証
 *
 * Phase 1: 認証不要の公開データ読み取りツールのみ。
 */
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb } from '../db/client';
import { requestOrigin } from './http';
import { TOOLS, TOOLS_BY_NAME } from './mcp/tools';

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26'];
const LATEST_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'Yorox', title: 'Yorox', version: '1.0.0' };

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
  result?: unknown;
  error?: unknown;
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

/**
 * Origin 検証。ブラウザからの cross-origin(DNS リバインディング)を弾く。
 * 非ブラウザの MCP クライアントは Origin を送らないので、未指定は許可する。
 */
function originAllowed(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

async function handleRpc(c: Context, msg: JsonRpcMessage): Promise<unknown> {
  const id = msg.id ?? null;
  const method = msg.method;
  const params = msg.params ?? {};

  switch (method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : LATEST_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Yorox(分散型イベント管理)の公開イベント/グループを検索・取得できます。',
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const db = createDb((await getEnv()).DB);
      const origin = await requestOrigin(c);
      try {
        const data = await tool.handler(db, origin, args);
        const isError = !!(data && typeof data === 'object' && 'error' in data);
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
          isError,
        });
      } catch (err) {
        return rpcResult(id, {
          content: [{ type: 'text', text: `ツール実行エラー: ${String(err)}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method ?? ''}`);
  }
}

const mcp = new Hono();

mcp.post('/mcp', async (c) => {
  if (!originAllowed(c)) return c.text('forbidden', 403);

  let msg: JsonRpcMessage;
  try {
    msg = (await c.req.json()) as JsonRpcMessage;
  } catch {
    return c.json(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (Array.isArray(msg)) {
    // 2025-06-18 でバッチは廃止
    return c.json(rpcError(null, -32600, 'Batch requests are not supported'), 400);
  }

  // notification / response(id なし)は 202 Accepted(body 無し)
  const isRequest = msg.method !== undefined && msg.id !== undefined && msg.id !== null;
  if (!isRequest) return c.body(null, 202);

  const response = await handleRpc(c, msg);
  return c.json(response, 200);
});

// SSE / セッションは未対応
mcp.get('/mcp', (c) => c.text('Method Not Allowed', 405));
mcp.delete('/mcp', (c) => c.text('Method Not Allowed', 405));

export default function mcpRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', mcp);
  return (_c, next) => next();
}
