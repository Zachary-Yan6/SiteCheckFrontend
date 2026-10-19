import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { clearAllTables, fakeDatabase } from '@/test/fakeExpoSqlite';
import { bootstrap } from '@/test/helpers';

import { clearCache, getSiteWithSchedules, listSitesWithSchedules, replaceCache } from './cacheRepository';
import { getDb } from './database';

jest.mock('expo-sqlite', () => require('@/test/fakeExpoSqlite'));

/** The offline copy of sites and templates (FR-07, FR-08), against a real (in-memory) SQLite. */
describe('cacheRepository', () => {
  beforeEach(async () => {
    await getDb();
    clearAllTables();
  });

  it('stores the bootstrap download and reads sites back with their checks', async () => {
    await replaceCache(bootstrap());

    expect(await listSitesWithSchedules()).toEqual([
      {
        id: 3,
        name: 'Cork Docklands Office Block',
        address: 'Kennedy Quay, Cork',
        schedules: [
          { templateId: 1, templateName: 'Scaffold Inspection', frequencyDays: 7, lastInspectedAt: '2026-10-01T09:00:00Z' },
          { templateId: 2, templateName: 'Lifting Equipment Check', frequencyDays: 30, lastInspectedAt: null },
        ],
      },
      // A site without checks still shows up (LEFT JOIN), with an empty list.
      { id: 5, name: 'Galway Student Residence', address: 'Headford Road, Galway', schedules: [] },
    ]);
    const meta = fakeDatabase().raw.prepare("SELECT value FROM meta WHERE key = 'cache_refreshed_at'").get();
    expect(meta).toEqual({ value: '2026-10-13T08:00:00Z' });
  });

  it('replaces the whole cache on refresh', async () => {
    await replaceCache(bootstrap());
    await replaceCache(bootstrap({ sites: [] }));

    expect(await listSitesWithSchedules()).toEqual([]);
    expect(fakeDatabase().raw.prepare('SELECT count(*) AS n FROM templates').get()).toEqual({ n: 2 });
  });

  it('keeps the old cache if the refresh fails half-way', async () => {
    await replaceCache(bootstrap());
    const broken = bootstrap();
    broken.sites.push({ ...broken.sites[0] }); // same id twice -> PRIMARY KEY error mid-transaction

    await expect(replaceCache(broken)).rejects.toThrow(/UNIQUE/);
    expect(await listSitesWithSchedules()).toHaveLength(2);
  });

  it('finds one site, or null if it is not on this phone', async () => {
    await replaceCache(bootstrap());
    expect((await getSiteWithSchedules(3))?.name).toBe('Cork Docklands Office Block');
    expect(await getSiteWithSchedules(99)).toBeNull();
  });

  it('counts an inspection submitted on this phone before it has synced', async () => {
    await replaceCache(bootstrap());
    const insert = fakeDatabase().raw.prepare(
      `INSERT INTO inspections (id, inspector_id, site_id, site_name, template_id, template_name, status,
                                started_at, updated_at, submitted_at)
       VALUES (?, 2, 3, 'Cork', ?, 'x', ?, 'now', 'now', ?)`,
    );
    insert.run('newer-local', 1, 'PENDING', '2026-10-12T09:00:00Z'); // later than the server's 1 Oct
    insert.run('older-local', 2, 'SYNCED', '2026-09-01T09:00:00Z'); // the server has never seen one
    insert.run('draft', 1, 'DRAFT', '2026-10-13T09:00:00Z'); // drafts don't count

    const [cork] = await listSitesWithSchedules();
    expect(cork.schedules.map((s) => s.lastInspectedAt)).toEqual(['2026-10-12T09:00:00Z', '2026-09-01T09:00:00Z']);
  });

  it('keeps the server date when it is later than the local one', async () => {
    await replaceCache(bootstrap());
    fakeDatabase().raw.exec(
      `INSERT INTO inspections (id, inspector_id, site_id, site_name, template_id, template_name, status,
                                started_at, updated_at, submitted_at)
       VALUES ('old', 2, 3, 'Cork', 1, 'x', 'SYNCED', 'now', 'now', '2026-09-20T09:00:00Z')`,
    );
    const [cork] = await listSitesWithSchedules();
    expect(cork.schedules[0].lastInspectedAt).toBe('2026-10-01T09:00:00Z');
  });

  it('clears everything on logout', async () => {
    await replaceCache(bootstrap());
    await clearCache();
    expect(await listSitesWithSchedules()).toEqual([]);
    expect(fakeDatabase().raw.prepare('SELECT count(*) AS n FROM meta').get()).toEqual({ n: 0 });
  });
});
