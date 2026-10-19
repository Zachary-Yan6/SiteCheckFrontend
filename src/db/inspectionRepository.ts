import * as Crypto from 'expo-crypto';

import { getDb } from '@/db/database';
import { checkForSubmit, type AnswerForRules, type ItemResult } from '@/inspection/submitRules';

export type InspectionStatus = 'DRAFT' | 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface Inspection {
  id: string;
  siteId: number;
  siteName: string;
  templateId: number;
  templateName: string;
  status: InspectionStatus;
  startedAt: string;
  submittedAt: string | null;
}

export interface Answer {
  templateItemId: number;
  position: number;
  title: string;
  guidance: string | null;
  result: ItemResult | null;
  note: string | null;
  photoCount: number;
}

/**
 * Opens the inspector's draft for this site and check, creating it if there isn't one (FR-10).
 * A new draft gets a phone-made UUID and a copy of the template's items, so from here on the
 * form needs nothing from the cache or the network.
 */
export async function startOrResumeDraft(inspectorId: number, siteId: number, templateId: number): Promise<string> {
  const db = await getDb();
  let inspectionId = '';
  await db.withExclusiveTransactionAsync(async (txn) => {
    const existing = await txn.getFirstAsync<{ id: string }>(
      "SELECT id FROM inspections WHERE inspector_id = ? AND site_id = ? AND template_id = ? AND status = 'DRAFT'",
      inspectorId, siteId, templateId,
    );
    if (existing) {
      inspectionId = existing.id;
      return;
    }

    const site = await txn.getFirstAsync<{ name: string }>('SELECT name FROM sites WHERE id = ?', siteId);
    const template = await txn.getFirstAsync<{ name: string }>('SELECT name FROM templates WHERE id = ?', templateId);
    if (!site || !template) {
      throw new Error('This site or checklist is no longer on this phone. Pull to refresh and try again.');
    }

    inspectionId = Crypto.randomUUID();
    const now = new Date().toISOString();
    await txn.runAsync(
      `INSERT INTO inspections (id, inspector_id, site_id, site_name, template_id, template_name, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      inspectionId, inspectorId, siteId, site.name, templateId, template.name, now, now,
    );
    await txn.runAsync(
      `INSERT INTO inspection_answers (inspection_id, template_item_id, position, title, guidance)
       SELECT ?, id, position, title, guidance FROM template_items WHERE template_id = ?`,
      inspectionId, templateId,
    );
  });
  return inspectionId;
}

export async function getInspection(id: string): Promise<Inspection | null> {
  const db = await getDb();
  return db.getFirstAsync<Inspection>(
    `SELECT id, site_id AS siteId, site_name AS siteName, template_id AS templateId,
            template_name AS templateName, status, started_at AS startedAt, submitted_at AS submittedAt
     FROM inspections WHERE id = ?`,
    id,
  );
}

export async function listAnswers(inspectionId: string): Promise<Answer[]> {
  const db = await getDb();
  return db.getAllAsync<Answer>(
    `SELECT a.template_item_id AS templateItemId, a.position, a.title, a.guidance, a.result, a.note,
            (SELECT count(*) FROM photos p
             WHERE p.inspection_id = a.inspection_id AND p.template_item_id = a.template_item_id) AS photoCount
     FROM inspection_answers a
     WHERE a.inspection_id = ?
     ORDER BY a.position`,
    inspectionId,
  );
}

/** Template id -> open draft id, for the site screen's "Continue" buttons. */
export async function findDraftsForSite(inspectorId: number, siteId: number): Promise<Map<number, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ templateId: number; id: string }>(
    "SELECT template_id AS templateId, id FROM inspections WHERE inspector_id = ? AND site_id = ? AND status = 'DRAFT'",
    inspectorId, siteId,
  );
  return new Map(rows.map((r) => [r.templateId, r.id]));
}

/*
 * Autosave (FR-14): every tap and keystroke is written straight to SQLite, so killing the app
 * loses nothing. The "status = 'DRAFT'" condition makes a submitted inspection read-only (FR-15)
 * even if some screen tried to write to it.
 */

export async function saveResult(inspectionId: string, templateItemId: number, result: ItemResult): Promise<void> {
  await updateAnswer(inspectionId, templateItemId, 'result', result);
}

export async function saveNote(inspectionId: string, templateItemId: number, note: string): Promise<void> {
  await updateAnswer(inspectionId, templateItemId, 'note', note);
}

async function updateAnswer(
  inspectionId: string,
  templateItemId: number,
  column: 'result' | 'note', // fixed set, so safe to put into the SQL text
  value: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE inspection_answers SET ${column} = ?
     WHERE inspection_id = ? AND template_item_id = ?
       AND EXISTS (SELECT 1 FROM inspections WHERE id = ? AND status = 'DRAFT')`,
    value, inspectionId, templateItemId, inspectionId,
  );
  await db.runAsync(
    "UPDATE inspections SET updated_at = ? WHERE id = ? AND status = 'DRAFT'",
    new Date().toISOString(), inspectionId,
  );
}

// ---------------------------------------------------------------------------------------------
// Photos (FR-13)
// ---------------------------------------------------------------------------------------------

export interface NewPhoto {
  id: string;
  inspectionId: string;
  templateItemId: number;
  fileUri: string;
  sizeBytes: number;
  takenAt: string;
  latitude: number | null;
  longitude: number | null;
}

export interface PhotoThumb {
  id: string;
  templateItemId: number;
  fileUri: string;
}

/** Records a photo that is already saved on disk. Refused once the inspection is submitted. */
export async function addPhoto(photo: NewPhoto): Promise<void> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO photos (id, inspection_id, template_item_id, file_uri, size_bytes, taken_at, latitude, longitude)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM inspections WHERE id = ? AND status = 'DRAFT')`,
    photo.id, photo.inspectionId, photo.templateItemId, photo.fileUri, photo.sizeBytes, photo.takenAt,
    photo.latitude, photo.longitude, photo.inspectionId,
  );
  if (result.changes === 0) {
    throw new Error('This inspection has already been submitted.');
  }
}

export async function listPhotos(inspectionId: string): Promise<PhotoThumb[]> {
  const db = await getDb();
  return db.getAllAsync<PhotoThumb>(
    `SELECT id, template_item_id AS templateItemId, file_uri AS fileUri
     FROM photos WHERE inspection_id = ? ORDER BY taken_at`,
    inspectionId,
  );
}

/** Removes a photo from a draft. Returns its file so the caller can delete it, or null if not allowed. */
export async function deletePhoto(photoId: string): Promise<string | null> {
  const db = await getDb();
  const photo = await db.getFirstAsync<{ fileUri: string }>(
    `SELECT p.file_uri AS fileUri FROM photos p JOIN inspections i ON i.id = p.inspection_id
     WHERE p.id = ? AND i.status = 'DRAFT'`,
    photoId,
  );
  if (!photo) return null;
  await db.runAsync('DELETE FROM photos WHERE id = ?', photoId);
  return photo.fileUri;
}

// ---------------------------------------------------------------------------------------------
// Submit (FR-15, FR-18)
// ---------------------------------------------------------------------------------------------

/**
 * Signs and submits: the inspection becomes read-only and goes into the sync queue - all in one
 * transaction, so it is never "submitted but not queued". Nothing touches the network here;
 * the user sees success immediately and the upload happens in the background later.
 */
export async function submitInspection(inspectionId: string, signaturePngBase64: string): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const inspection = await txn.getFirstAsync<{ status: InspectionStatus }>(
      'SELECT status FROM inspections WHERE id = ?',
      inspectionId,
    );
    if (inspection?.status !== 'DRAFT') {
      throw new Error('This inspection has already been submitted.');
    }

    // Same rules as the form shows, checked once more against what is actually stored.
    const answers = await txn.getAllAsync<AnswerForRules>(
      `SELECT a.template_item_id AS templateItemId, a.result, a.note,
              (SELECT count(*) FROM photos p
               WHERE p.inspection_id = a.inspection_id AND p.template_item_id = a.template_item_id) AS photoCount
       FROM inspection_answers a WHERE a.inspection_id = ?`,
      inspectionId,
    );
    if (!checkForSubmit(answers).canSubmit) {
      throw new Error('Some items are still incomplete.');
    }

    const now = new Date().toISOString();
    await txn.runAsync(
      "UPDATE inspections SET status = 'PENDING', submitted_at = ?, signature_png = ?, updated_at = ? WHERE id = ?",
      now, signaturePngBase64, now, inspectionId,
    );
    await txn.runAsync(
      'INSERT INTO sync_queue (inspection_id, next_attempt_at, created_at) VALUES (?, ?, ?)',
      inspectionId, now, now,
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Sync status per record (FR-24)
// ---------------------------------------------------------------------------------------------

export interface SubmittedInspection {
  id: string;
  templateName: string;
  status: InspectionStatus;
  submittedAt: string;
  lastError: string | null;
}

/** This inspector's submitted inspections for a site, newest first, with their sync status. */
export async function listSubmittedForSite(inspectorId: number, siteId: number): Promise<SubmittedInspection[]> {
  const db = await getDb();
  return db.getAllAsync<SubmittedInspection>(
    `SELECT i.id, i.template_name AS templateName, i.status, i.submitted_at AS submittedAt,
            q.last_error AS lastError
     FROM inspections i LEFT JOIN sync_queue q ON q.inspection_id = i.id
     WHERE i.inspector_id = ? AND i.site_id = ? AND i.status <> 'DRAFT'
     ORDER BY i.submitted_at DESC
     LIMIT 20`,
    inspectorId, siteId,
  );
}
