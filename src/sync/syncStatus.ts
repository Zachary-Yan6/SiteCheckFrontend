import { create } from 'zustand';

/** What the sync banner shows (FR-25). UI state only - the real queue lives in SQLite. */
export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  /** Submitted inspections not yet on the server. */
  waiting: number;
  /** Inspections that gave up and need a manual retry. */
  failed: number;
  /** The server rejected the token: user must log in again before anything else uploads. */
  authRequired: boolean;
}

export const useSyncStatus = create<SyncStatus>(() => ({
  isOnline: true,
  isSyncing: false,
  waiting: 0,
  failed: 0,
  authRequired: false,
}));

export type Tone = 'info' | 'warning' | 'error';

/** The banner's text and colour for a given status, or null to hide it. */
export function bannerMessage(s: SyncStatus): { text: string; tone: Tone } | null {
  const pending = `${s.waiting} ${s.waiting === 1 ? 'inspection' : 'inspections'}`;
  if (s.authRequired) {
    return { text: `Session expired. Log in again to upload ${pending}.`, tone: 'error' };
  }
  if (s.failed > 0) {
    return { text: `${s.failed} failed to sync - open the site to retry.`, tone: 'error' };
  }
  if (!s.isOnline) {
    return {
      text: s.waiting > 0 ? `Offline - ${pending} waiting to sync` : 'Offline - inspections still work',
      tone: 'warning',
    };
  }
  if (s.waiting > 0) {
    return { text: s.isSyncing ? `Syncing ${pending}...` : `${pending} waiting to sync`, tone: 'info' };
  }
  return null;
}
