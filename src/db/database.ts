import * as SQLite from 'expo-sqlite';

/**
 * The phone's local database - the source of truth for everything the app shows (FR-17).
 * Opened once and shared, so non-React code (like the sync engine later) can use it too.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = open().catch((error) => {
      dbPromise = null; // let the next call try again
      throw error;
    });
  }
  return dbPromise;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('sitecheck.db');
  // WAL: reads don't block writes, and a crash mid-write can't corrupt the file (NFR-02).
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrate(db);
  return db;
}

/**
 * Schema versions, applied in order. The current version is stored in SQLite's built-in
 * `user_version`, so each migration runs exactly once per install. Never edit a migration
 * that has shipped - add a new one, like Flyway on the backend.
 */
const MIGRATIONS: string[] = [
  // 1: read-only cache of what /api/sync/bootstrap returns (FR-07). Replaced wholesale on refresh.
  `
  CREATE TABLE sites (
    id        INTEGER PRIMARY KEY,
    name      TEXT NOT NULL,
    address   TEXT NOT NULL,
    latitude  REAL,
    longitude REAL
  );

  CREATE TABLE templates (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT,
    frequency_days INTEGER NOT NULL
  );

  CREATE TABLE template_items (
    id          INTEGER PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    title       TEXT NOT NULL,
    guidance    TEXT
  );
  CREATE INDEX idx_template_items_template ON template_items (template_id, position);

  -- Which checks each site needs and when each was last done on the server (FR-08).
  CREATE TABLE site_schedules (
    site_id           INTEGER NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    template_id       INTEGER NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
    last_inspected_at TEXT,  -- ISO-8601, null = never
    PRIMARY KEY (site_id, template_id)
  );

  -- Small key/value facts, e.g. when the cache was last refreshed.
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // 2: the user's own work - inspections, answers, photos and the sync queue (FR-14, FR-17, FR-18).
  // No foreign keys to the cache tables above: a refresh replaces the cache wholesale and must
  // never delete or block an inspection. Anything the form needs is copied in when it starts.
  `
  CREATE TABLE inspections (
    id            TEXT PRIMARY KEY,   -- UUID made on the phone; the server's idempotency key (FR-20)
    inspector_id  INTEGER NOT NULL,   -- whose work this is, in case someone else logs in on this phone
    site_id       INTEGER NOT NULL,
    site_name     TEXT NOT NULL,      -- copied so the record still reads right if the site leaves the cache
    template_id   INTEGER NOT NULL,
    template_name TEXT NOT NULL,
    -- FR-24: DRAFT -> PENDING (submitted, waiting) -> SYNCING -> SYNCED, or FAILED (can retry)
    status        TEXT NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT', 'PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
    started_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    submitted_at  TEXT,               -- set on submit; read-only from then on (FR-15)
    signature_png TEXT                -- base64 PNG
  );
  -- At most one open draft per inspector, site and check: "Start" resumes it instead of starting over.
  CREATE UNIQUE INDEX uk_inspections_open_draft
    ON inspections (inspector_id, site_id, template_id) WHERE status = 'DRAFT';

  -- One row per checklist item, created when the draft starts. Title etc. are copied from the
  -- template so the form still works if the template changes or leaves the cache mid-inspection.
  CREATE TABLE inspection_answers (
    inspection_id    TEXT    NOT NULL REFERENCES inspections (id) ON DELETE CASCADE,
    template_item_id INTEGER NOT NULL,
    position         INTEGER NOT NULL,
    title            TEXT    NOT NULL,
    guidance         TEXT,
    result           TEXT CHECK (result IN ('PASS', 'FAIL', 'NA')),  -- null = not answered yet
    note             TEXT,
    PRIMARY KEY (inspection_id, template_item_id)
  );

  CREATE TABLE photos (
    id               TEXT PRIMARY KEY,  -- UUID made on the phone
    inspection_id    TEXT    NOT NULL REFERENCES inspections (id) ON DELETE CASCADE,
    template_item_id INTEGER NOT NULL,
    file_uri         TEXT    NOT NULL,  -- compressed JPEG in the app's document folder
    size_bytes       INTEGER NOT NULL,
    taken_at         TEXT    NOT NULL,
    latitude         REAL,
    longitude        REAL,
    upload_status    TEXT NOT NULL DEFAULT 'PENDING' CHECK (upload_status IN ('PENDING', 'UPLOADED'))
  );
  CREATE INDEX idx_photos_inspection ON photos (inspection_id);

  -- The outbox: one row per submitted inspection still to be sent (FR-18). The job is "send the
  -- record, then its photos" (FR-21); the row is deleted once everything is on the server.
  CREATE TABLE sync_queue (
    inspection_id   TEXT PRIMARY KEY REFERENCES inspections (id) ON DELETE CASCADE,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT    NOT NULL,   -- backoff (FR-23): don't retry before this time
    last_error      TEXT,
    created_at      TEXT    NOT NULL
  );
  `,
];

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (let version = current + 1; version <= MIGRATIONS.length; version++) {
    // Each migration and its version bump commit together, so a crash can't half-apply one.
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(MIGRATIONS[version - 1]);
      await txn.execAsync(`PRAGMA user_version = ${version}`);
    });
  }
}
