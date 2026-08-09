/**
 * D1 互換の SQLite シム(Docker / Node ランタイム用)。
 * drizzle-orm/d1 ドライバが使う API 面(prepare→bind→run/all/raw/first、batch、exec)
 * を better-sqlite3 の上に実装する。これによりアプリの DB コード
 * (`.meta.changes` を含む)は Cloudflare 版と完全に共通のまま動く。
 */
import type BetterSqlite3 from 'better-sqlite3';

type SqliteDb = BetterSqlite3.Database;

interface D1Meta {
  changes: number;
  last_row_id: number;
  duration: number;
  rows_read: number;
  rows_written: number;
}

interface D1ResultShim<T = unknown> {
  success: true;
  results: T[];
  meta: D1Meta;
}

function meta(changes = 0, lastRowId = 0): D1Meta {
  return {
    changes,
    last_row_id: lastRowId,
    duration: 0,
    rows_read: 0,
    rows_written: changes,
  };
}

/** better-sqlite3 が受け付ける値へ変換(boolean → 0/1 など) */
function toSqliteParam(v: unknown): unknown {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (v instanceof Date) return v.getTime();
  return v;
}

class D1PreparedStatementShim {
  constructor(
    private readonly db: SqliteDb,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): D1PreparedStatementShim {
    return new D1PreparedStatementShim(this.db, this.sql, params.map(toSqliteParam));
  }

  private prepare() {
    return this.db.prepare(this.sql);
  }

  async run(): Promise<D1ResultShim> {
    const stmt = this.prepare();
    if (stmt.reader) {
      // SELECT 等は run できないため all 相当で返す(D1 の run も results を返す)
      const results = stmt.all(...this.params);
      return { success: true, results, meta: meta() };
    }
    const info = stmt.run(...this.params);
    return { success: true, results: [], meta: meta(info.changes, Number(info.lastInsertRowid)) };
  }

  async all<T = unknown>(): Promise<D1ResultShim<T>> {
    const stmt = this.prepare();
    if (!stmt.reader) {
      const info = stmt.run(...this.params);
      return {
        success: true,
        results: [],
        meta: meta(info.changes, Number(info.lastInsertRowid)),
      };
    }
    return { success: true, results: stmt.all(...this.params) as T[], meta: meta() };
  }

  /** 行を配列(カラム順)で返す。columnNames オプションは drizzle では未使用 */
  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt = this.prepare();
    if (!stmt.reader) {
      stmt.run(...this.params);
      return [];
    }
    return stmt.raw(true).all(...this.params) as T[];
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const { results } = await this.all<Record<string, unknown>>();
    const row = results[0];
    if (row === undefined) return null;
    if (column !== undefined) return (row[column] as T) ?? null;
    return row as T;
  }
}

export class D1DatabaseShim {
  constructor(private readonly db: SqliteDb) {}

  prepare(sql: string): D1PreparedStatementShim {
    return new D1PreparedStatementShim(this.db, sql);
  }

  /** アプリでは未使用。D1 と同様に順次実行して結果を返す(BEGIN/COMMIT で包む) */
  async batch(statements: D1PreparedStatementShim[]): Promise<D1ResultShim[]> {
    const results: D1ResultShim[] = [];
    this.db.exec('BEGIN');
    try {
      for (const stmt of statements) {
        results.push(await stmt.all());
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return results;
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }
}
