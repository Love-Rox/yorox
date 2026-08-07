import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

/**
 * D1 バインディングから Drizzle クライアントを作る。
 * サーバーコンポーネント/Hono ルートからは
 * `import { env } from 'cloudflare:workers'` で env.DB を取得して渡す。
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };
