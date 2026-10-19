import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import { useAuth } from '@/auth/authStore';
import { createSyncApi } from '@/sync/syncApi';
import { runSync } from '@/sync/syncEngine';
import { useSyncStatus } from '@/sync/syncStatus';
import { nextAttemptAt, recoverInterruptedSyncs, resetFailed, sqliteSyncStore, syncCounts } from '@/sync/syncStore';

/*
 * Decides WHEN to sync (FR-19); the engine decides HOW. Triggers:
 *   - the phone comes back online,
 *   - the app returns to the foreground,
 *   - pull-to-refresh and "Submit" call requestSync() directly,
 *   - a timer for the next scheduled retry while the app is open.
 * Background sync while the app is closed (FR-26, "could") is not done.
 */

let running: Promise<void> | null = null;
let runAgain = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start a sync pass now. If one is already running, another pass follows it (never two at once).
 * Never rejects, so callers can fire and forget: the queue in SQLite is the source of truth and
 * the next trigger simply tries again.
 */
export function requestSync(): Promise<void> {
  if (running) {
    runAgain = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        runAgain = false;
        await syncOnce();
      } while (runAgain);
    } catch (error) {
      console.warn('Sync pass failed', error);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncOnce(): Promise<void> {
  const session = useAuth.getState().session;
  const status = useSyncStatus.getState();
  if (!session || status.authRequired) return;

  if (!status.isOnline) {
    await refreshCounts();
    return; // nothing to do until NetInfo says we're back
  }

  useSyncStatus.setState({ isSyncing: true });
  try {
    const result = await runSync({
      store: sqliteSyncStore,
      api: createSyncApi(session.token),
      inspectorId: session.user.id,
    });
    if (result.authRequired) useSyncStatus.setState({ authRequired: true });
  } finally {
    useSyncStatus.setState({ isSyncing: false });
    await refreshCounts();
    await scheduleNextRetry();
  }
}

/** Re-reads the banner counts from SQLite, e.g. right after a submit. */
export async function refreshCounts(): Promise<void> {
  const session = useAuth.getState().session;
  if (!session) {
    useSyncStatus.setState({ waiting: 0, failed: 0 });
    return;
  }
  useSyncStatus.setState(await syncCounts(session.user.id));
}

async function scheduleNextRetry(): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const session = useAuth.getState().session;
  if (!session || useSyncStatus.getState().authRequired) return;

  const next = await nextAttemptAt(session.user.id);
  if (next) {
    retryTimer = setTimeout(requestSync, Math.max(0, next.getTime() - Date.now()));
  }
}

/** FR-23: the user tapped Retry on a failed inspection. */
export async function retryInspection(inspectionId: string): Promise<void> {
  await resetFailed(inspectionId);
  await requestSync();
}

/**
 * Called once the user is logged in. Returns a function that stops all triggers (on logout).
 */
export function startSyncTriggers(): () => void {
  useSyncStatus.setState({ authRequired: false });

  const netInfoUnsubscribe = NetInfo.addEventListener((state) => {
    // isInternetReachable is null while unknown; only "false" means definitely offline.
    const isOnline = state.isConnected === true && state.isInternetReachable !== false;
    const cameOnline = isOnline && !useSyncStatus.getState().isOnline;
    useSyncStatus.setState({ isOnline });
    if (cameOnline) requestSync();
  });

  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') requestSync();
  });

  // A sync the app was killed in the middle of starts over (every step is safe to repeat).
  recoverInterruptedSyncs().then(requestSync);

  return () => {
    netInfoUnsubscribe();
    appStateSubscription.remove();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
}
