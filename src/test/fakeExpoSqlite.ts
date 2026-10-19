/**
 * Test stand-in for expo-sqlite, backed by Node's built-in SQLite (node:sqlite). The app's real
 * SQL - migrations, joins, CHECK constraints, transactions - runs against a real SQLite engine,
 * just in memory instead of on the phone.
 *
 * Use in a test file with:  jest.mock('expo-sqlite', () => require('@/test/fakeExpoSqlite'));
 *
 * Only the parts of the expo-sqlite API the app uses are implemented.
 */
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

type Param = string | number | null;

export class FakeSQLiteDatabase {
  /** Transactions are exclusive in expo-sqlite; this queue gives the same one-at-a-time order. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly raw: InstanceType<typeof DatabaseSync>) {}

  async execAsync(sql: string): Promise<void> {
    this.raw.exec(sql);
  }

  async runAsync(sql: string, ...params: Param[]): Promise<{ changes: number; lastInsertRowId: number }> {
    const result = this.raw.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async getFirstAsync<T>(sql: string, ...params: Param[]): Promise<T | null> {
    const row = this.raw.prepare(sql).get(...params);
    return row === undefined ? null : ({ ...row } as T);
  }

  async getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params).map((row) => ({ ...row }) as T);
  }

  withExclusiveTransactionAsync(task: (txn: FakeSQLiteDatabase) => Promise<void>): Promise<void> {
    const run = this.queue.then(async () => {
      this.raw.exec('BEGIN EXCLUSIVE');
      try {
        await task(this);
        this.raw.exec('COMMIT');
      } catch (error) {
        this.raw.exec('ROLLBACK');
        throw error;
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

const databases = new Map<string, FakeSQLiteDatabase>();
let failuresLeft = 0;

export async function openDatabaseAsync(name: string): Promise<FakeSQLiteDatabase> {
  if (failuresLeft > 0) {
    failuresLeft--;
    throw new Error('disk I/O error');
  }
  let db = databases.get(name);
  if (!db) {
    db = new FakeSQLiteDatabase(new DatabaseSync(':memory:'));
    databases.set(name, db);
  }
  return db;
}

// ------------------------------------------------------------------ helpers for tests only

/** The database the app opened (or will open) under this name. */
export function fakeDatabase(name = 'sitecheck.db'): FakeSQLiteDatabase {
  const db = databases.get(name);
  if (!db) throw new Error(`The app has not opened ${name} yet`);
  return db;
}

/** Makes the next `count` opens fail, like a full or locked disk. */
export function failNextOpens(count: number): void {
  failuresLeft = count;
}

/** Empties every table but keeps the schema, so each test starts from a clean, migrated database. */
export function clearAllTables(name = 'sitecheck.db'): void {
  const db = databases.get(name);
  if (!db) return;
  const tables = db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  db.raw.exec('PRAGMA foreign_keys = OFF');
  for (const { name: table } of tables) db.raw.exec(`DELETE FROM ${table}`);
  db.raw.exec('PRAGMA foreign_keys = ON');
}
