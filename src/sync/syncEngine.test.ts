import { beforeEach, describe, expect, it } from '@jest/globals';

import { ApiError, NetworkError } from '@/api/client';

import {
  backoffDelayMs,
  MAX_ATTEMPTS,
  RetryableError,
  runSync,
  type LocalPhoto,
  type SubmitPayload,
  type SyncApi,
  type SyncStore,
  type UploadTarget,
} from './syncEngine';

const NOW = new Date('2026-10-13T09:00:00Z');
const noJitter = () => 0.5; // backoffDelayMs then returns exactly the base delay

// ------------------------------------------------------------------------- in-memory fakes

interface FakeInspection {
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  queued: boolean;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  photos: LocalPhoto[];
}

class FakeStore implements SyncStore {
  inspections = new Map<string, FakeInspection>();

  add(id: string, photoIds: string[] = [], attempts = 0) {
    this.inspections.set(id, {
      status: 'PENDING',
      queued: true,
      attempts,
      nextAttemptAt: NOW,
      lastError: null,
      photos: photoIds.map((p) => ({ id: p, sizeBytes: 1000, fileUri: `file:///${p}.jpg`, uploaded: false })),
    });
  }

  get(id: string) {
    return this.inspections.get(id)!;
  }

  async dueJobs(_inspectorId: number, now: Date) {
    return [...this.inspections.entries()]
      .filter(([, i]) => i.queued && i.status !== 'FAILED' && i.nextAttemptAt <= now)
      .map(([inspectionId, i]) => ({ inspectionId, attempts: i.attempts }));
  }
  async loadInspection(id: string) {
    const payload = { id, photos: [] } as unknown as SubmitPayload;
    return { payload, photos: this.get(id).photos.map((p) => ({ ...p })) };
  }
  async markSyncing(id: string) {
    this.get(id).status = 'SYNCING';
  }
  async markPhotoUploaded(photoId: string) {
    for (const i of this.inspections.values()) {
      const photo = i.photos.find((p) => p.id === photoId);
      if (photo) photo.uploaded = true;
    }
  }
  async markSynced(id: string) {
    Object.assign(this.get(id), { status: 'SYNCED', queued: false });
  }
  async scheduleRetry(id: string, attempts: number, nextAttemptAt: Date, error: string) {
    Object.assign(this.get(id), { status: 'PENDING', attempts, nextAttemptAt, lastError: error });
  }
  async markFailed(id: string, attempts: number, error: string) {
    Object.assign(this.get(id), { status: 'FAILED', attempts, lastError: error });
  }
  async release(id: string) {
    this.get(id).status = 'PENDING';
  }
}

/** Fake server: remembers stored inspections and photos, like the real idempotent backend. */
class FakeApi implements SyncApi {
  storedInspections = new Set<string>();
  storedPhotos = new Set<string>();
  calls: string[] = [];
  /** Set to make the next call of that kind throw. */
  failNext: Partial<Record<'submit' | 'uploadUrl' | 'upload' | 'confirm', Error>> = {};

  private maybeFail(kind: keyof FakeApi['failNext']) {
    const error = this.failNext[kind];
    if (error) {
      delete this.failNext[kind];
      throw error;
    }
  }

  async submitInspection(payload: SubmitPayload) {
    this.calls.push(`submit ${payload.id}`);
    this.maybeFail('submit');
    this.storedInspections.add(payload.id);
    return { pendingPhotoIds: this.pendingFor(payload.id) };
  }
  async requestUploadUrl(photoId: string): Promise<UploadTarget> {
    this.calls.push(`uploadUrl ${photoId}`);
    this.maybeFail('uploadUrl');
    return this.storedPhotos.has(photoId)
      ? { alreadyUploaded: true, url: null, headers: {} }
      : { alreadyUploaded: false, url: `https://s3/${photoId}`, headers: { 'Content-Type': 'image/jpeg' } };
  }
  async uploadFile(url: string) {
    this.calls.push(`upload ${url}`);
    this.maybeFail('upload');
  }
  async confirmPhoto(photoId: string) {
    this.calls.push(`confirm ${photoId}`);
    this.maybeFail('confirm');
    this.storedPhotos.add(photoId);
  }

  /** Test hook: which photos the server would still list as pending. */
  photosByInspection = new Map<string, string[]>();
  private pendingFor(inspectionId: string) {
    return (this.photosByInspection.get(inspectionId) ?? []).filter((p) => !this.storedPhotos.has(p));
  }
}

// ------------------------------------------------------------------------- tests

let store: FakeStore;
let api: FakeApi;
const sync = (now = NOW) => runSync({ store, api, inspectorId: 1, now: () => now, random: noJitter });

beforeEach(() => {
  store = new FakeStore();
  api = new FakeApi();
});

function queueInspection(id: string, photoIds: string[] = []) {
  store.add(id, photoIds);
  api.photosByInspection.set(id, photoIds);
}

describe('runSync', () => {
  it('uploads the record first, then each photo, then marks it synced', async () => {
    queueInspection('i1', ['p1', 'p2']);

    const result = await sync();

    expect(result).toEqual({ synced: 1, retrying: 0, failed: 0, authRequired: false });
    expect(api.calls).toEqual([
      'submit i1',
      'uploadUrl p1', 'upload https://s3/p1', 'confirm p1',
      'uploadUrl p2', 'upload https://s3/p2', 'confirm p2',
    ]);
    expect(store.get('i1').status).toBe('SYNCED');
    expect(store.get('i1').queued).toBe(false);
  });

  it('resumes after a failure without re-uploading finished photos (acceptance scenario 3)', async () => {
    queueInspection('i1', ['p1', 'p2']);
    // p1 goes through, then the connection drops while uploading p2.
    const realUpload = api.uploadFile.bind(api);
    api.uploadFile = async (url: string) => {
      if (url.endsWith('p2')) throw new NetworkError();
      return realUpload(url);
    };

    const first = await sync();
    expect(first.retrying).toBe(1);
    expect(store.get('i1').status).toBe('PENDING');

    api.uploadFile = realUpload;
    api.calls = [];
    const second = await sync(new Date(NOW.getTime() + 60_000));

    expect(second.synced).toBe(1);
    // The record is sent again (idempotent), but only the missing photo is uploaded.
    expect(api.calls).toEqual(['submit i1', 'uploadUrl p2', 'upload https://s3/p2', 'confirm p2']);
  });

  it('skips photos the server already has (e.g. the confirm response was lost)', async () => {
    queueInspection('i1', ['p1']);
    api.storedPhotos.add('p1');

    await sync();

    expect(api.calls).toEqual(['submit i1']);
    expect(store.get('i1').photos[0].uploaded).toBe(true);
    expect(store.get('i1').status).toBe('SYNCED');
  });

  it('schedules a retry with backoff on network errors and server errors', async () => {
    queueInspection('i1');
    queueInspection('i2');
    api.failNext.submit = new NetworkError();

    const result = await sync();

    expect(result).toMatchObject({ synced: 1, retrying: 1 });
    expect(store.get('i1')).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'No connection to the server' });
    expect(store.get('i1').nextAttemptAt).toEqual(new Date(NOW.getTime() + 30_000));
  });

  it('does not retry before the backoff time has passed', async () => {
    queueInspection('i1');
    api.failNext.submit = new ApiError(503, 'Service unavailable');
    await sync();
    api.calls = [];

    await sync(new Date(NOW.getTime() + 10_000));
    expect(api.calls).toEqual([]);

    await sync(new Date(NOW.getTime() + 31_000));
    expect(api.calls).toEqual(['submit i1']);
  });

  it('treats a 409 on photo confirm as retryable', async () => {
    queueInspection('i1', ['p1']);
    api.failNext.confirm = new RetryableError('Photo file has not been uploaded yet');

    const result = await sync();

    expect(result.retrying).toBe(1);
    expect(store.get('i1').status).toBe('PENDING');
  });

  it('marks the inspection FAILED on a permanent 4xx, without retrying', async () => {
    queueInspection('i1');
    api.failNext.submit = new ApiError(400, 'Item 7 is not in this template');

    const result = await sync();

    expect(result.failed).toBe(1);
    expect(store.get('i1')).toMatchObject({ status: 'FAILED', lastError: 'Item 7 is not in this template' });
  });

  it('gives up after MAX_ATTEMPTS temporary failures', async () => {
    store.add('i1', [], MAX_ATTEMPTS - 1);
    api.failNext.submit = new NetworkError();

    const result = await sync();

    expect(result.failed).toBe(1);
    expect(store.get('i1').status).toBe('FAILED');
  });

  it('stops everything on 401 and keeps the data waiting, without counting an attempt', async () => {
    queueInspection('i1');
    queueInspection('i2');
    api.failNext.submit = new ApiError(401, 'Missing or invalid token');

    const result = await sync();

    expect(result.authRequired).toBe(true);
    expect(api.calls).toEqual(['submit i1']); // i2 not even tried
    expect(store.get('i1')).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(store.get('i2')).toMatchObject({ status: 'PENDING', attempts: 0 });
  });
});

describe('backoffDelayMs', () => {
  it('doubles from 30 seconds and caps at 30 minutes', () => {
    expect([1, 2, 3, 4, 7, 20].map((a) => backoffDelayMs(a, noJitter))).toEqual([
      30_000, 60_000, 120_000, 240_000, 1_800_000, 1_800_000,
    ]);
  });

  it('adds up to 20% jitter either way', () => {
    expect(backoffDelayMs(1, () => 0)).toBe(24_000);
    expect(backoffDelayMs(1, () => 1)).toBe(36_000);
  });
});
