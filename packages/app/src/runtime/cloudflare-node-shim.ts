/**
 * Docker / Node ランタイム用の `cloudflare:workers` シム。
 * YOROX_TARGET=node ビルドで vite エイリアスにより差し替えられる。
 *
 * - env: process.env + DB(D1 互換 SQLite シム)+ FILES(R2 互換 FS バケット)
 * - 起動時に drizzle/migrations を適用(_journal.json 順、適用済みは記録)
 */
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { D1DatabaseShim } from './d1-shim';

const require = createRequire(import.meta.url);

const DATA_DIR = process.env.DATA_DIR ?? './data';

/** R2 互換の FS バケット(storage/driver.ts の R2StorageDriver がそのまま使える) */
class FsBucket {
  constructor(private readonly root: string) {
    mkdirSync(this.root, { recursive: true });
  }

  /** キーを root 配下に閉じ込める(パストラバーサル防止) */
  private resolve(key: string): string {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error(`invalid storage key: ${key}`);
    }
    return p;
  }

  async put(
    key: string,
    data: ArrayBuffer,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    const p = this.resolve(key);
    mkdirSync(path.dirname(p), { recursive: true });
    await writeFile(p, Buffer.from(data));
    if (opts?.httpMetadata?.contentType) {
      await writeFile(`${p}.meta`, JSON.stringify(opts.httpMetadata));
    }
  }

  async get(key: string): Promise<{
    body: ReadableStream;
    size: number;
    httpMetadata?: { contentType?: string };
  } | null> {
    const p = this.resolve(key);
    try {
      const info = await stat(p);
      let httpMetadata: { contentType?: string } | undefined;
      try {
        httpMetadata = JSON.parse(await readFile(`${p}.meta`, 'utf8'));
      } catch {
        /* meta なし */
      }
      const body = Readable.toWeb(
        Readable.from(await readFile(p)),
      ) as unknown as ReadableStream;
      const result: {
        body: ReadableStream;
        size: number;
        httpMetadata?: { contentType?: string };
      } = { body, size: info.size };
      if (httpMetadata) result.httpMetadata = httpMetadata;
      return result;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const p = this.resolve(key);
    await unlink(p).catch(() => {});
    await unlink(`${p}.meta`).catch(() => {});
  }
}

/** drizzle/migrations を _journal.json の順に適用する(適用済みは記録) */
function runMigrations(db: import('better-sqlite3').Database, migrationsDir: string): void {
  if (!existsSync(migrationsDir)) {
    console.warn(`[node] migrations dir not found: ${migrationsDir}`);
    return;
  }
  db.exec(
    'CREATE TABLE IF NOT EXISTS _yorox_migrations (tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const journalPath = path.join(migrationsDir, 'meta', '_journal.json');
  const tags: string[] = existsSync(journalPath)
    ? (
        JSON.parse(readFileSync(journalPath, 'utf8')) as {
          entries: { tag: string }[];
        }
      ).entries.map((e) => e.tag)
    : readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => f.replace(/\.sql$/, ''))
        .sort();

  const applied = new Set(
    (db.prepare('SELECT tag FROM _yorox_migrations').all() as { tag: string }[]).map(
      (r) => r.tag,
    ),
  );
  for (const tag of tags) {
    if (applied.has(tag)) continue;
    const sql = readFileSync(path.join(migrationsDir, `${tag}.sql`), 'utf8');
    db.exec('BEGIN');
    try {
      for (const stmt of sql.split('--> statement-breakpoint')) {
        if (stmt.trim()) db.exec(stmt);
      }
      db.prepare('INSERT INTO _yorox_migrations (tag, applied_at) VALUES (?, ?)').run(
        tag,
        Date.now(),
      );
      db.exec('COMMIT');
      console.log(`[node] migration applied: ${tag}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function buildEnv(): Env {
  mkdirSync(DATA_DIR, { recursive: true });
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const sqlite = new Database(path.join(DATA_DIR, 'yorox.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const migrationsDir =
    process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'drizzle/migrations');
  runMigrations(sqlite, migrationsDir);

  const shim: Record<string, unknown> = {
    ...process.env,
    DB: new D1DatabaseShim(sqlite),
    FILES:
      process.env.FILE_UPLOADS === '1'
        ? new FsBucket(path.join(DATA_DIR, 'files'))
        : undefined,
    // Cloudflare Email binding は Node では存在しない(SMTP を使う)
    EMAIL: undefined,
    SLOT_COORDINATOR: undefined,
  };
  return shim as unknown as Env;
}

export const env: Env = buildEnv();
