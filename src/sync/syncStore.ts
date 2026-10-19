import { getDb } from '@/db/database';
import type { InspectionStatus } from '@/db/inspectionRepository';
import type { LocalPhoto, QueuedInspection, SubmitPayload, SyncStore } from '@/sync/syncEngine';

/** The SyncStore the engine uses in the app: sync_queue, inspections and photos in SQLite. */
export const sqliteSyncStore: SyncStore = {
  async dueJobs(inspectorId, now) {
    const db = await getDb();
    return db.getAllAsync<QueuedInspection>(
      `SELECT q.inspection_id AS inspectionId, q.attempts
       FROM sync_queue q JOIN inspections i ON i.id = q.inspection_id
       WHERE i.inspector_id = ? AND i.status IN ('PENDING', 'SYNCING') AND q.next_attempt_at <= ?
       ORDER BY q.created_at`,
      inspectorId, now.toISOString(),
    );
  },

  async loadInspection(inspectionId) {
    const db = await getDb();
    const inspection = await db.getFirstAsync<{
      siteId: number;
      templateId: number;
      startedAt: string;
      submittedAt: string;
      signaturePng: string;
    }>(
      `SELECT site_id AS siteId, template_id AS templateId, started_at AS startedAt,
              submitted_at AS submittedAt, signature_png AS signaturePng
       FROM inspections WHERE id = ?`,
      inspectionId,
    );
    if (!inspection) throw new Error(`Inspection ${inspectionId} is missing from the phone`);

    const results = await db.getAllAsync<SubmitPayload['results'][number]>(
      `SELECT template_item_id AS templateItemId, result, note
       FROM inspection_answers WHERE inspection_id = ? AND result IS NOT NULL ORDER BY position`,
      inspectionId,
    );
    const photoRows = await db.getAllAsync<{
      id: string;
      templateItemId: number;
      takenAt: string;
      latitude: number | null;
      longitude: number | null;
      sizeBytes: number;
      fileUri: string;
      uploadStatus: 'PENDING' | 'UPLOADED';
    }>(
      `SELECT id, template_item_id AS templateItemId, taken_at AS takenAt, latitude, longitude,
              size_bytes AS sizeBytes, file_uri AS fileUri, upload_status AS uploadStatus
       FROM photos WHERE inspection_id = ? ORDER BY taken_at`,
      inspectionId,
    );

    const payload: SubmitPayload = {
      id: inspectionId,
      ...inspection,
      results,
      photos: photoRows.map(({ id, templateItemId, takenAt, latitude, longitude }) => ({
        id, templateItemId, takenAt, latitude, longitude,
      })),
    };
    const photos: LocalPhoto[] = photoRows.map((p) => ({
      id: p.id,
      sizeBytes: p.sizeBytes,
      fileUri: p.fileUri,
      uploaded: p.uploadStatus === 'UPLOADED',
    }));
    return { payload, photos };
  },

  async markSyncing(inspectionId) {
    await setStatus(inspectionId, 'SYNCING');
  },

  async markPhotoUploaded(photoId) {
    const db = await getDb();
    await db.runAsync("UPDATE photos SET upload_status = 'UPLOADED' WHERE id = ?", photoId);
  },

  async markSynced(inspectionId) {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync("UPDATE inspections SET status = 'SYNCED' WHERE id = ?", inspectionId);
      await txn.runAsync('DELETE FROM sync_queue WHERE inspection_id = ?', inspectionId);
    });
  },

  async scheduleRetry(inspectionId, attempts, nextAttemptAt, error) {
    await updateQueue(inspectionId, 'PENDING', attempts, nextAttemptAt.toISOString(), error);
  },

  async markFailed(inspectionId, attempts, error) {
    // The queue row stays, so a manual retry just resets it.
    await updateQueue(inspectionId, 'FAILED', attempts, null, error);
  },

  async release(inspectionId) {
    await setStatus(inspectionId, 'PENDING');
  },
};

async function setStatus(inspectionId: string, status: InspectionStatus): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE inspections SET status = ? WHERE id = ?', status, inspectionId);
}

async function updateQueue(
  inspectionId: string,
  status: InspectionStatus,
  attempts: number,
  nextAttemptAt: string | null, // null = leave as is
  error: string,
): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('UPDATE inspections SET status = ? WHERE id = ?', status, inspectionId);
    await txn.runAsync(
      `UPDATE sync_queue SET attempts = ?, next_attempt_at = coalesce(?, next_attempt_at), last_error = ?
       WHERE inspection_id = ?`,
      attempts, nextAttemptAt, error, inspectionId,
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Used by the sync manager and screens, not by the engine
// ---------------------------------------------------------------------------------------------

/** On app start: a sync the app was killed in the middle of goes back to waiting (NFR-02). */
export async function recoverInterruptedSyncs(): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE inspections SET status = 'PENDING' WHERE status = 'SYNCING'");
}

/** FR-23: manual retry of a FAILED inspection - starts again as if freshly submitted. */
export async function resetFailed(inspectionId: string): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync("UPDATE inspections SET status = 'PENDING' WHERE id = ? AND status = 'FAILED'", inspectionId);
    await txn.runAsync(
      'UPDATE sync_queue SET attempts = 0, next_attempt_at = ?, last_error = NULL WHERE inspection_id = ?',
      new Date().toISOString(), inspectionId,
    );
  });
}

/** Earliest scheduled retry for this inspector, so the manager can set a timer. */
export async function nextAttemptAt(inspectorId: number): Promise<Date | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ next: string | null }>(
    `SELECT min(q.next_attempt_at) AS next
     FROM sync_queue q JOIN inspections i ON i.id = q.inspection_id
     WHERE i.inspector_id = ? AND i.status = 'PENDING'`,
    inspectorId,
  );
  return row?.next ? new Date(row.next) : null;
}

/** For the "N waiting to sync" banner (FR-25). */
export async function syncCounts(inspectorId: number): Promise<{ waiting: number; failed: number }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ waiting: number; failed: number }>(
    `SELECT coalesce(sum(status IN ('PENDING', 'SYNCING')), 0) AS waiting,
            coalesce(sum(status = 'FAILED'), 0) AS failed
     FROM inspections WHERE inspector_id = ?`,
    inspectorId,
  );
  return row ?? { waiting: 0, failed: 0 };
}
