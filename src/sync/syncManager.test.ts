import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@/auth/authStore';
import { createSyncApi } from '@/sync/syncApi';
import { runSync, type SyncApi, type SyncResult } from '@/sync/syncEngine';
import { useSyncStatus } from '@/sync/syncStatus';
import { nextAttemptAt, recoverInterruptedSyncs, resetFailed, sqliteSyncStore, syncCounts } from '@/sync/syncStore';
import { AOIFE, sessionFor } from '@/test/helpers';

import { refreshCounts, requestSync, retryInspection, startSyncTriggers } from './syncManager';

jest.mock('@/sync/syncEngine', () => ({ runSync: jest.fn() }));
jest.mock('@/sync/syncApi', () => ({ createSyncApi: jest.fn() }));
jest.mock('@/sync/syncStore', () => ({
  sqliteSyncStore: { name: 'sqlite store' },
  nextAttemptAt: jest.fn(),
  recoverInterruptedSyncs: jest.fn(),
  resetFailed: jest.fn(),
  syncCounts: jest.fn(),
}));
jest.mock('@/db/cacheRepository', () => ({}));
jest.mock('@/notifications/pushNotifications', () => ({}));

let mockNetInfoListener: ((state: NetInfoState) => void) | null = null;
const mockNetInfoUnsubscribe = jest.fn();
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn((listener: (state: NetInfoState) => void) => {
      mockNetInfoListener = listener;
      return mockNetInfoUnsubscribe;
    }),
  },
}));

const synced: SyncResult = { synced: 1, retrying: 0, failed: 0, authRequired: false };
const api = { name: 'api' } as unknown as SyncApi;
const session = sessionFor(AOIFE);

/** Lets a sync pass that a trigger started (fire and forget) run to the end. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function network(isConnected: boolean, isInternetReachable: boolean | null = isConnected) {
  mockNetInfoListener!({ isConnected, isInternetReachable } as NetInfoState);
}

/** FR-19: when syncing happens. What a pass does is the sync engine's job (syncEngine.test.ts). */
describe('syncManager', () => {
  let appStateListener: ((state: AppStateStatus) => void) | null;
  const appStateRemove = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.setState({ status: 'signedIn', session });
    useSyncStatus.setState({ isOnline: true, isSyncing: false, waiting: 0, failed: 0, authRequired: false });
    jest.mocked(runSync).mockResolvedValue(synced);
    jest.mocked(createSyncApi).mockReturnValue(api);
    jest.mocked(syncCounts).mockResolvedValue({ waiting: 0, failed: 0 });
    jest.mocked(nextAttemptAt).mockResolvedValue(null);
    jest.mocked(recoverInterruptedSyncs).mockResolvedValue();
    appStateListener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener;
      return { remove: appStateRemove };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('requestSync', () => {
    it('runs the engine for the logged-in inspector and refreshes the banner', async () => {
      jest.mocked(syncCounts).mockResolvedValue({ waiting: 2, failed: 1 });
      jest.mocked(runSync).mockImplementationOnce(async () => {
        expect(useSyncStatus.getState().isSyncing).toBe(true);
        return synced;
      });

      await requestSync();

      expect(createSyncApi).toHaveBeenCalledWith(session.token);
      expect(runSync).toHaveBeenCalledWith({ store: sqliteSyncStore, api, inspectorId: AOIFE.id });
      expect(useSyncStatus.getState()).toMatchObject({ isSyncing: false, waiting: 2, failed: 1 });
    });

    it('only refreshes the counts while offline', async () => {
      useSyncStatus.setState({ isOnline: false });
      jest.mocked(syncCounts).mockResolvedValue({ waiting: 1, failed: 0 });

      await requestSync();

      expect(runSync).not.toHaveBeenCalled();
      expect(useSyncStatus.getState().waiting).toBe(1);
    });

    it('does nothing when logged out or waiting for a re-login', async () => {
      useAuth.setState({ status: 'signedOut', session: null });
      await requestSync();
      useAuth.setState({ status: 'signedIn', session });
      useSyncStatus.setState({ authRequired: true });
      await requestSync();

      expect(runSync).not.toHaveBeenCalled();
    });

    it('stops and asks for a login when the server rejects the token', async () => {
      jest.mocked(runSync).mockResolvedValueOnce({ ...synced, authRequired: true });
      jest.mocked(nextAttemptAt).mockResolvedValue(new Date());

      await requestSync();

      expect(useSyncStatus.getState().authRequired).toBe(true);
      expect(nextAttemptAt).not.toHaveBeenCalled(); // no retry timer until the user logs in again
    });

    it('never runs two passes at once, but does one more after the current pass', async () => {
      let finishFirst: (result: SyncResult) => void = () => {};
      jest.mocked(runSync).mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)));

      const first = requestSync();
      const second = requestSync(); // e.g. the user pulls to refresh while a sync runs
      expect(second).toBe(first);
      finishFirst(synced);
      await first;

      expect(runSync).toHaveBeenCalledTimes(2);
    });

    it('never rejects, so callers can fire and forget', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.mocked(runSync).mockRejectedValueOnce(new Error('database is locked'));

      await expect(requestSync()).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith('Sync pass failed', expect.any(Error));
      expect(useSyncStatus.getState().isSyncing).toBe(false);
    });

    it('sets a timer for the next scheduled retry', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-13T09:00:00Z') });
      jest.mocked(nextAttemptAt).mockResolvedValueOnce(new Date('2026-10-13T09:00:30Z'));

      await requestSync();
      expect(runSync).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(30_000);
      expect(runSync).toHaveBeenCalledTimes(2);
    });
  });

  it('refreshCounts shows nothing waiting when logged out', async () => {
    useSyncStatus.setState({ waiting: 3, failed: 1 });
    useAuth.setState({ status: 'signedOut', session: null });
    await refreshCounts();
    expect(useSyncStatus.getState()).toMatchObject({ waiting: 0, failed: 0 });
  });

  it('retryInspection resets a failed inspection and syncs straight away', async () => {
    await retryInspection('insp-1');
    expect(resetFailed).toHaveBeenCalledWith('insp-1');
    expect(runSync).toHaveBeenCalled();
  });

  describe('startSyncTriggers', () => {
    it('recovers interrupted syncs and syncs once at start', async () => {
      useSyncStatus.setState({ authRequired: true }); // left over from the previous session
      const stop = startSyncTriggers();
      await flush();

      expect(useSyncStatus.getState().authRequired).toBe(false);
      expect(runSync).toHaveBeenCalled();
      stop();
    });

    it('syncs when the phone comes back online, not on every network change', async () => {
      const stop = startSyncTriggers();
      await flush();
      jest.mocked(runSync).mockClear();

      network(false);
      expect(useSyncStatus.getState().isOnline).toBe(false);
      network(true, null); // reachability not known yet still counts as online
      await flush();
      expect(runSync).toHaveBeenCalledTimes(1);

      jest.mocked(runSync).mockClear();
      network(true); // already online: no extra pass
      expect(runSync).not.toHaveBeenCalled();
      stop();
    });

    it('syncs when the app returns to the foreground', async () => {
      const stop = startSyncTriggers();
      await flush();
      jest.mocked(runSync).mockClear();

      appStateListener!('background');
      expect(runSync).not.toHaveBeenCalled();
      appStateListener!('active');
      await flush();
      expect(runSync).toHaveBeenCalledTimes(1);
      stop();
    });

    it('stops every trigger on logout, including a pending retry timer', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-13T09:00:00Z') });
      jest.mocked(nextAttemptAt).mockResolvedValue(new Date('2026-10-13T09:01:00Z'));
      const stop = startSyncTriggers();
      await jest.advanceTimersByTimeAsync(0);
      jest.mocked(runSync).mockClear();

      stop();
      await jest.advanceTimersByTimeAsync(120_000);

      expect(mockNetInfoUnsubscribe).toHaveBeenCalled();
      expect(appStateRemove).toHaveBeenCalled();
      expect(runSync).not.toHaveBeenCalled();
      expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1);
    });
  });
});
