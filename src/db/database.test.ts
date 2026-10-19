import { describe, expect, it, jest } from '@jest/globals';

import { failNextOpens, fakeDatabase } from '@/test/fakeExpoSqlite';

import { getDb } from './database';

jest.mock('expo-sqlite', () => require('@/test/fakeExpoSqlite'));

/** Opening and migrating the phone's database, against a real (in-memory) SQLite. */
describe('getDb', () => {
  it('tries again on the next call when opening fails', async () => {
    failNextOpens(1);
    await expect(getDb()).rejects.toThrow('disk I/O error');

    const db = await getDb();
    expect(db).toBe(await getDb()); // opened once, then shared
  });

  it('applies every migration once and records the schema version', async () => {
    await getDb();
    const raw = fakeDatabase().raw;

    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    expect(tables.map((t) => t.name)).toEqual([
      'inspection_answers', 'inspections', 'meta', 'photos', 'site_schedules', 'sites', 'sync_queue',
      'template_items', 'templates',
    ]);
  });

  it('enforces the schema rules, e.g. only one open draft per site and check', async () => {
    await getDb();
    const raw = fakeDatabase().raw;
    const insertDraft = raw.prepare(
      `INSERT INTO inspections (id, inspector_id, site_id, site_name, template_id, template_name, started_at, updated_at)
       VALUES (?, 2, 3, 'Cork', 1, 'Scaffold', 'now', 'now')`,
    );
    insertDraft.run('a');
    expect(() => insertDraft.run('b')).toThrow(/UNIQUE/);
    expect(() => raw.exec("UPDATE inspections SET status = 'LOST'")).toThrow(/CHECK/);
  });
});
