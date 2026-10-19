import type { BootstrapResponse } from '@/api/types';
import { getDb } from '@/db/database';
import type { SiteInput } from '@/schedule/dueStatus';

/**
 * Replaces the cached sites/templates with a fresh bootstrap snapshot, all in one transaction:
 * if the app is killed half-way, the old cache is still there intact.
 */
export async function replaceCache(data: BootstrapResponse): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    // Children first, then parents. A full replace is simplest and the data is small.
    await txn.execAsync(`
      DELETE FROM site_schedules;
      DELETE FROM template_items;
      DELETE FROM templates;
      DELETE FROM sites;
    `);

    for (const t of data.templates) {
      await txn.runAsync(
        'INSERT INTO templates (id, name, description, frequency_days) VALUES (?, ?, ?, ?)',
        t.id, t.name, t.description, t.frequencyDays,
      );
      for (const item of t.items) {
        await txn.runAsync(
          'INSERT INTO template_items (id, template_id, position, title, guidance) VALUES (?, ?, ?, ?, ?)',
          item.id, t.id, item.position, item.title, item.guidance,
        );
      }
    }

    for (const s of data.sites) {
      await txn.runAsync(
        'INSERT INTO sites (id, name, address, latitude, longitude) VALUES (?, ?, ?, ?, ?)',
        s.id, s.name, s.address, s.latitude, s.longitude,
      );
      for (const schedule of s.schedules) {
        await txn.runAsync(
          'INSERT INTO site_schedules (site_id, template_id, last_inspected_at) VALUES (?, ?, ?)',
          s.id, schedule.templateId, schedule.lastInspectedAt,
        );
      }
    }

    await txn.runAsync(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('cache_refreshed_at', ?)",
      data.serverTime,
    );
  });
}

/** Wipes the cache, e.g. on logout so the next user doesn't see these sites. */
export async function clearCache(): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(`
      DELETE FROM site_schedules;
      DELETE FROM template_items;
      DELETE FROM templates;
      DELETE FROM sites;
      DELETE FROM meta;
    `);
  });
}

interface SiteScheduleRow {
  site_id: number;
  site_name: string;
  address: string;
  template_id: number | null; // null when the site has no checks (LEFT JOIN)
  template_name: string | null;
  frequency_days: number | null;
  last_inspected_at: string | null;
  local_last_submitted_at: string | null;
}

/** Every cached site with its checks, ready for the due-date rules in schedule/dueStatus.ts. */
export async function listSitesWithSchedules(): Promise<SiteInput[]> {
  return querySitesWithSchedules(null);
}

/** One cached site with its checks, or null if it's not on this phone (any more). */
export async function getSiteWithSchedules(siteId: number): Promise<SiteInput | null> {
  const [site] = await querySitesWithSchedules(siteId);
  return site ?? null;
}

/** @param siteId one site, or null for all of them */
async function querySitesWithSchedules(siteId: number | null): Promise<SiteInput[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SiteScheduleRow>(
    `SELECT s.id AS site_id, s.name AS site_name, s.address,
            t.id AS template_id, t.name AS template_name, t.frequency_days, ss.last_inspected_at,
            -- Inspections submitted on this phone count straight away, even before they sync.
            (SELECT max(i.submitted_at) FROM inspections i
             WHERE i.site_id = s.id AND i.template_id = ss.template_id AND i.status <> 'DRAFT') AS local_last_submitted_at
     FROM sites s
     LEFT JOIN site_schedules ss ON ss.site_id = s.id
     LEFT JOIN templates t ON t.id = ss.template_id
     WHERE ? IS NULL OR s.id = ?
     ORDER BY s.id`,
    siteId, siteId,
  );

  // One row per (site, check) -> one object per site with a list of checks.
  const sites = new Map<number, SiteInput>();
  for (const row of rows) {
    let site = sites.get(row.site_id);
    if (!site) {
      site = { id: row.site_id, name: row.site_name, address: row.address, schedules: [] };
      sites.set(row.site_id, site);
    }
    if (row.template_id !== null) {
      site.schedules.push({
        templateId: row.template_id,
        templateName: row.template_name!,
        frequencyDays: row.frequency_days!,
        lastInspectedAt: later(row.last_inspected_at, row.local_last_submitted_at),
      });
    }
  }
  return [...sites.values()];
}

/** The later of two ISO timestamps (either may be null). Compared as instants, not as text. */
function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}
