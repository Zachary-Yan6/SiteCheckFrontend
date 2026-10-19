import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ApiError } from '@/api/client';
import { replaceCache } from '@/db/cacheRepository';
import { getDb } from '@/db/database';
import { addPhoto, getInspection, saveNote, saveResult, startOrResumeDraft, submitInspection } from '@/db/inspectionRepository';
import { clearAllTables, fakeDatabase } from '@/test/fakeExpoSqlite';
import { AOIFE, bootstrap } from '@/test/helpers';

import { runSync, type SyncApi } from './syncEngine';
import { nextAttemptAt, recoverInterruptedSyncs, resetFailed, sqliteSyncStore, syncCounts } from './syncStore';

jest.mock('expo-sqlite', () => require('@/test/fakeExpoSqlite'));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));

const LIAM_ID = 3;

/**
 * The sync queue in SQLite (FR-18 to FR-24), and the sync engine running against it end to end:
 * submit offline, then upload when the server is reachable.
 */
describe('sqliteSyncStore', () => {
  let inspectionId: string;

  beforeEach(async () => {
    await getDb();
    clearAllTables();
    await replaceCache(bootstrap());
    inspectionId = await submitted(AOIFE.id);
  });

  it('lists due jobs of this inspector only, and not before their retry time', async () => {
    await submitted(LIAM_ID);
    const now = new Date(Date.now() + 1000);

    expect(await sqliteSyncStore.dueJobs(AOIFE.id, now)).toEqual([{ inspectionId, attempts: 0 }]);

    await sqliteSyncStore.scheduleRetry(inspectionId, 1, new Date(now.getTime() + 60_000), 'Server busy');
    expect(await sqliteSyncStore.dueJobs(AOIFE.id, now)).toEqual([]);
    expect(await nextAttemptAt(AOIFE.id)).toEqual(new Date(now.getTime() + 60_000));
  });

  it('builds the upload payload from what is stored', async () => {
    const { payload, photos } = await sqliteSyncStore.loadInspection(inspectionId);

    expect(payload).toMatchObject({
      id: inspectionId,
      siteId: 3,
      templateId: 1,
      signaturePng: 'iVBORw0KGgo=',
      results: [
        { templateItemId: 10, result: 'PASS', note: null },
        { templateItemId: 11, result: 'FAIL', note: 'Rail missing' },
      ],
      photos: [{ id: `${inspectionId}-photo`, templateItemId: 11, latitude: 51.9, longitude: -8.45 }],
    });
    expect(photos).toEqual([
      { id: `${inspectionId}-photo`, sizeBytes: 300_000, fileUri: 'file:///photo.jpg', uploaded: false },
    ]);
    await expect(sqliteSyncStore.loadInspection('missing')).rejects.toThrow('missing from the phone');
  });

  it('records failures, and a manual retry starts over', async () => {
    await sqliteSyncStore.markFailed(inspectionId, 3, 'Item 11 is not in this template');

    expect(await syncCounts(AOIFE.id)).toEqual({ waiting: 0, failed: 1 });
    expect(await nextAttemptAt(AOIFE.id)).toBeNull();
    expect(queueRow()).toMatchObject({ attempts: 3, last_error: 'Item 11 is not in this template' });

    await resetFailed(inspectionId);
    expect((await getInspection(inspectionId))?.status).toBe('PENDING');
    expect(queueRow()).toMatchObject({ attempts: 0, last_error: null });
  });

  it('puts a sync that was interrupted by the app being killed back to waiting', async () => {
    await sqliteSyncStore.markSyncing(inspectionId);
    await recoverInterruptedSyncs();
    expect((await getInspection(inspectionId))?.status).toBe('PENDING');

    await sqliteSyncStore.markSyncing(inspectionId);
    await sqliteSyncStore.release(inspectionId);
    expect((await getInspection(inspectionId))?.status).toBe('PENDING');
  });

  it('counts nothing for an inspector without inspections', async () => {
    expect(await syncCounts(999)).toEqual({ waiting: 0, failed: 0 });
  });

  describe('with the sync engine', () => {
    it('uploads the record, then its photo, then clears the queue', async () => {
      const api = fakeApi();

      const result = await runSync({ store: sqliteSyncStore, api, inspectorId: AOIFE.id });

      expect(result).toEqual({ synced: 1, retrying: 0, failed: 0, authRequired: false });
      expect(api.calls).toEqual(['submit', 'uploadUrl', 'upload', 'confirm']);
      expect((await getInspection(inspectionId))?.status).toBe('SYNCED');
      expect(queueRow()).toBeUndefined();
      expect(await syncCounts(AOIFE.id)).toEqual({ waiting: 0, failed: 0 });
    });

    it('keeps the inspection queued with a backoff when the server is down', async () => {
      const api = fakeApi();
      api.submitInspection = async () => {
        throw new ApiError(503, 'Service unavailable');
      };

      const result = await runSync({ store: sqliteSyncStore, api, inspectorId: AOIFE.id, random: () => 0.5 });

      expect(result.retrying).toBe(1);
      expect((await getInspection(inspectionId))?.status).toBe('PENDING');
      expect(queueRow()).toMatchObject({ attempts: 1, last_error: 'Service unavailable' });
    });
  });

  // ---------------------------------------------------------------- helpers

  /** A submitted Scaffold inspection at Cork: item 11 failed, with one photo. */
  async function submitted(inspectorId: number): Promise<string> {
    const id = await startOrResumeDraft(inspectorId, 3, 1);
    await saveResult(id, 10, 'PASS');
    await saveResult(id, 11, 'FAIL');
    await saveNote(id, 11, 'Rail missing');
    await addPhoto({
      id: `${id}-photo`, inspectionId: id, templateItemId: 11, fileUri: 'file:///photo.jpg', sizeBytes: 300_000,
      takenAt: '2026-10-13T09:05:00Z', latitude: 51.9, longitude: -8.45,
    });
    await submitInspection(id, 'iVBORw0KGgo=');
    return id;
  }

  function queueRow() {
    return fakeDatabase().raw.prepare('SELECT * FROM sync_queue WHERE inspection_id = ?').get(inspectionId);
  }

  function fakeApi(): SyncApi & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async submitInspection(payload) {
        calls.push('submit');
        return { pendingPhotoIds: payload.photos.map((p) => p.id) };
      },
      async requestUploadUrl() {
        calls.push('uploadUrl');
        return { alreadyUploaded: false, url: 'https://s3.test/put', headers: { 'Content-Type': 'image/jpeg' } };
      },
      async uploadFile() {
        calls.push('upload');
      },
      async confirmPhoto() {
        calls.push('confirm');
      },
    };
  }
});
