import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { clearAllTables, fakeDatabase } from '@/test/fakeExpoSqlite';
import { AOIFE, bootstrap } from '@/test/helpers';

import { replaceCache } from './cacheRepository';
import { getDb } from './database';
import {
  addPhoto,
  deletePhoto,
  findDraftsForSite,
  getInspection,
  listAnswers,
  listPhotos,
  listSubmittedForSite,
  saveNote,
  saveResult,
  startOrResumeDraft,
  submitInspection,
  type NewPhoto,
} from './inspectionRepository';

jest.mock('expo-sqlite', () => require('@/test/fakeExpoSqlite'));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));

const CORK = 3;
const SCAFFOLD = 1;

/** Drafts, autosave, photos and submit (FR-10 to FR-18), against a real (in-memory) SQLite. */
describe('inspectionRepository', () => {
  beforeEach(async () => {
    await getDb();
    clearAllTables();
    await replaceCache(bootstrap());
  });

  describe('drafts', () => {
    it('starts a draft with a copy of the checklist, and resumes it next time', async () => {
      const id = await startOrResumeDraft(AOIFE.id, CORK, SCAFFOLD);

      expect(await getInspection(id)).toMatchObject({
        id, siteId: CORK, siteName: 'Cork Docklands Office Block', templateName: 'Scaffold Inspection',
        status: 'DRAFT', submittedAt: null,
      });
      expect(await listAnswers(id)).toEqual([
        { templateItemId: 10, position: 1, title: 'Base plates and sole boards', guidance: 'Check for sinking',
          result: null, note: null, photoCount: 0 },
        { templateItemId: 11, position: 2, title: 'Guard rails in place', guidance: null,
          result: null, note: null, photoCount: 0 },
      ]);
      expect(await startOrResumeDraft(AOIFE.id, CORK, SCAFFOLD)).toBe(id);
      expect(await findDraftsForSite(AOIFE.id, CORK)).toEqual(new Map([[SCAFFOLD, id]]));
    });

    it('refuses to start a check that is no longer in the cache', async () => {
      await expect(startOrResumeDraft(AOIFE.id, CORK, 99)).rejects.toThrow('no longer on this phone');
      await expect(startOrResumeDraft(AOIFE.id, 99, SCAFFOLD)).rejects.toThrow('no longer on this phone');
    });

    it('keeps the draft working after the cache is refreshed without its template', async () => {
      const id = await startOrResumeDraft(AOIFE.id, CORK, SCAFFOLD);
      await replaceCache(bootstrap({ templates: [], sites: [] }));
      expect(await listAnswers(id)).toHaveLength(2);
    });

    it('returns null for an unknown inspection', async () => {
      expect(await getInspection('nope')).toBeNull();
    });
  });

  describe('autosave', () => {
    it('saves results and notes straight away', async () => {
      const id = await startOrResumeDraft(AOIFE.id, CORK, SCAFFOLD);
      await saveResult(id, 10, 'FAIL');
      await saveNote(id, 10, 'Sole board missing');

      expect((await listAnswers(id))[0]).toMatchObject({ result: 'FAIL', note: 'Sole board missing' });
    });

    it('ignores changes once the inspection is submitted', async () => {
      const id = await submittedInspection();
      await saveResult(id, 10, 'FAIL');
      expect((await listAnswers(id))[0].result).toBe('PASS');
    });
  });

  describe('photos', () => {
    it('adds, counts, lists and deletes photos of a draft', async () => {
      const id = await startOrResumeDraft(AOIFE.id, CORK, SCAFFOLD);
      await addPhoto(photo(id, 'p2', '2026-10-13T09:10:00Z'));
      await addPhoto(photo(id, 'p1', '2026-10-13T09:05:00Z'));

      expect((await listAnswers(id))[0].photoCount).toBe(2);
      expect((await listPhotos(id)).map((p) => p.id)).toEqual(['p1', 'p2']); // in the order taken

      expect(await deletePhoto('p1')).toBe('file:///photos/p1.jpg');
      expect(await listPhotos(id)).toEqual([{ id: 'p2', templateItemId: 10, fileUri: 'file:///photos/p2.jpg' }]);
    });

    it('refuses photos for a submitted inspection, and keeps the ones it has', async () => {
      const id = await submittedInspection();
      await expect(addPhoto(photo(id, 'late', '2026-10-13T10:00:00Z'))).rejects.toThrow('already been submitted');
      expect(await deletePhoto('evidence')).toBeNull();
      expect(await listPhotos(id)).toHaveLength(1);
    });
  });

  describe('submit', () => {
    it('makes the inspection read-only and puts it in the sync queue', async () => {
      const id = await submittedInspection();

      expect(await getInspection(id)).toMatchObject({ status: 'PENDING', submittedAt: expect.any(String) });
      const queued = fakeDatabase().raw.prepare('SELECT attempts FROM sync_queue WHERE inspection_id = ?').get(id);
      expect(queued).toEqual({ attempts: 0 });
      expect(await findDraftsForSite(AOIFE.id, CORK)).toEqual(new Map());
      expect(await listSubmittedForSite(AOIFE.id, CORK)).toEqual([
        { id, templateName: 'Scaffold Inspection', status: 'PENDING', submittedAt: expect.any(String), lastError: null },
      ]);
    });

    it('refuses an incomplete checklist', async () => {
      const id = await startOrResumeDraft(AOIFE.id, CORK, SCAFFOLD);
      await saveResult(id, 10, 'PASS');
      await expect(submitInspection(id, 'png')).rejects.toThrow('still incomplete');
      expect((await getInspection(id))?.status).toBe('DRAFT');
    });

    it('refuses a FAIL without its photo', async () => {
      const id = await startOrResumeDraft(AOIFE.id, CORK, SCAFFOLD);
      await saveResult(id, 10, 'FAIL');
      await saveNote(id, 10, 'Cracked');
      await saveResult(id, 11, 'PASS');
      await expect(submitInspection(id, 'png')).rejects.toThrow('still incomplete');
    });

    it('refuses to submit twice', async () => {
      const id = await submittedInspection();
      await expect(submitInspection(id, 'png')).rejects.toThrow('already been submitted');
      await expect(submitInspection('unknown', 'png')).rejects.toThrow('already been submitted');
    });
  });

  // ---------------------------------------------------------------- helpers

  /** Item 10 FAIL with note and photo "evidence", item 11 PASS - then signed and submitted. */
  async function submittedInspection(): Promise<string> {
    const id = await startOrResumeDraft(AOIFE.id, CORK, SCAFFOLD);
    await saveResult(id, 10, 'PASS');
    await saveResult(id, 11, 'FAIL');
    await saveNote(id, 11, 'Rail missing on level 3');
    await addPhoto({ ...photo(id, 'evidence', '2026-10-13T09:05:00Z'), templateItemId: 11 });
    await submitInspection(id, 'iVBORw0KGgo=');
    return id;
  }

  function photo(inspectionId: string, id: string, takenAt: string): NewPhoto {
    return {
      id, inspectionId, templateItemId: 10, fileUri: `file:///photos/${id}.jpg`, sizeBytes: 300_000, takenAt,
      latitude: 51.9, longitude: -8.45,
    };
  }
});
