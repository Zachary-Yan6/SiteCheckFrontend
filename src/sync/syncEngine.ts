import { ApiError } from '@/api/client';

/*
 * The sync engine (FR-18 to FR-23): uploads queued inspections, then their photos.
 *
 * It only talks to two interfaces - SyncStore (the local database) and SyncApi (the server) - so
 * the retry and ordering logic can be unit-tested with fakes, no phone or network needed.
 *
 * Every step is safe to repeat, which is what makes "just try again" a correct recovery for any
 * failure, including the app being killed mid-sync:
 *   - the inspection upload is idempotent on its UUID (backend returns the same receipt),
 *   - the receipt says which photos the server still needs, so finished ones are skipped,
 *   - a photo upload URL / confirm can be repeated.
 */

export interface QueuedInspection {
  inspectionId: string;
  attempts: number;
}

export interface LocalPhoto {
  id: string;
  sizeBytes: number;
  fileUri: string;
  uploaded: boolean;
}

/** Body of POST /api/inspections - mirrors the backend's SubmitInspectionRequest. */
export interface SubmitPayload {
  id: string;
  siteId: number;
  templateId: number;
  startedAt: string;
  submittedAt: string;
  signaturePng: string;
  results: { templateItemId: number; result: string; note: string | null }[];
  photos: { id: string; templateItemId: number; takenAt: string; latitude: number | null; longitude: number | null }[];
}

export interface SyncStore {
  /** Queued inspections of this inspector whose retry time has come, oldest first. */
  dueJobs(inspectorId: number, now: Date): Promise<QueuedInspection[]>;
  loadInspection(inspectionId: string): Promise<{ payload: SubmitPayload; photos: LocalPhoto[] }>;
  markSyncing(inspectionId: string): Promise<void>;
  markPhotoUploaded(photoId: string): Promise<void>;
  /** Everything is on the server: status SYNCED and the queue row removed. */
  markSynced(inspectionId: string): Promise<void>;
  scheduleRetry(inspectionId: string, attempts: number, nextAttemptAt: Date, error: string): Promise<void>;
  /** Gives up until the user taps Retry (FR-23). */
  markFailed(inspectionId: string, attempts: number, error: string): Promise<void>;
  /** Back to waiting without counting an attempt - used when we stop for a re-login. */
  release(inspectionId: string): Promise<void>;
}

export interface UploadTarget {
  alreadyUploaded: boolean;
  url: string | null;
  headers: Record<string, string>;
}

export interface SyncApi {
  submitInspection(payload: SubmitPayload): Promise<{ pendingPhotoIds: string[] }>;
  requestUploadUrl(photoId: string, sizeBytes: number): Promise<UploadTarget>;
  uploadFile(url: string, headers: Record<string, string>, fileUri: string): Promise<void>;
  confirmPhoto(photoId: string): Promise<void>;
}

/**
 * A failure that is worth retrying even though it isn't a network error - e.g. S3 rejecting an
 * expired upload URL, or the server saying a photo hasn't arrived yet (409 on confirm).
 */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

/** After this many failed tries an inspection is marked FAILED and waits for a manual retry. */
export const MAX_ATTEMPTS = 8;

const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 30 * 60_000;

/**
 * Exponential backoff (FR-23): 30s, 1m, 2m, 4m ... capped at 30 minutes, with +/-20% jitter so a
 * crew of phones regaining signal together don't all hit the server at the same moment.
 */
export function backoffDelayMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(FIRST_RETRY_MS * 2 ** (attempts - 1), MAX_RETRY_MS);
  return Math.round(base * (0.8 + random() * 0.4));
}

export interface SyncResult {
  synced: number;
  retrying: number;
  failed: number;
  /** The server rejected our token: stop and ask the user to log in again (FR-03). */
  authRequired: boolean;
}

export interface SyncDeps {
  store: SyncStore;
  api: SyncApi;
  inspectorId: number;
  now?: () => Date;
  random?: () => number;
}

/** One pass over the queue. Never throws: every outcome is recorded in the store. */
export async function runSync({ store, api, inspectorId, now = () => new Date(), random }: SyncDeps): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, retrying: 0, failed: 0, authRequired: false };

  for (const job of await store.dueJobs(inspectorId, now())) {
    try {
      await syncInspection(store, api, job.inspectionId);
      result.synced++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (error instanceof ApiError && error.status === 401) {
        // Token expired. Nothing is wrong with the data - park it and stop the whole run;
        // every other job would get a 401 too.
        await store.release(job.inspectionId);
        result.authRequired = true;
        break;
      }

      const attempts = job.attempts + 1;
      if (isPermanent(error) || attempts >= MAX_ATTEMPTS) {
        await store.markFailed(job.inspectionId, attempts, message);
        result.failed++;
      } else {
        const nextAttemptAt = new Date(now().getTime() + backoffDelayMs(attempts, random));
        await store.scheduleRetry(job.inspectionId, attempts, nextAttemptAt, message);
        result.retrying++;
      }
    }
  }
  return result;
}

/** Record first, then its photos (FR-21). Throws on the first failure; the next run resumes. */
async function syncInspection(store: SyncStore, api: SyncApi, inspectionId: string): Promise<void> {
  await store.markSyncing(inspectionId);
  const { payload, photos } = await store.loadInspection(inspectionId);

  // Safe to send again after a lost response or a crash: same UUID -> same stored record.
  const receipt = await api.submitInspection(payload);
  const serverNeeds = new Set(receipt.pendingPhotoIds);

  for (const photo of photos.filter((p) => !p.uploaded)) {
    if (serverNeeds.has(photo.id)) {
      const target = await api.requestUploadUrl(photo.id, photo.sizeBytes);
      if (!target.alreadyUploaded) {
        await api.uploadFile(target.url!, target.headers, photo.fileUri);
        await api.confirmPhoto(photo.id);
      }
    }
    // Either we just uploaded it, or the server already had it from an earlier, interrupted run.
    await store.markPhotoUploaded(photo.id);
  }

  await store.markSynced(inspectionId);
}

/**
 * A 4xx (other than 401 / timeout / rate limit) means the server will never accept this request
 * as it is, so retrying only wastes battery. Everything else - no signal, 5xx, RetryableError -
 * is temporary.
 */
function isPermanent(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 408, 429].includes(error.status)
  );
}
