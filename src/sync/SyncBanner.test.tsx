import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { useAuth } from '@/auth/authStore';
import { AOIFE, sessionFor } from '@/test/helpers';

import { SyncBanner } from './SyncBanner';
import { useSyncStatus } from './syncStatus';

jest.mock('@/auth/sessionStorage', () => ({ clearSession: jest.fn() }));
jest.mock('@/db/cacheRepository', () => ({}));
jest.mock('@/notifications/pushNotifications', () => ({}));
jest.mock('@/sync/syncStore', () => ({}));

/** FR-25: the status strip. Its wording is tested in syncStatus.test.ts. */
describe('SyncBanner', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'signedIn', session: sessionFor(AOIFE) });
    useSyncStatus.setState({ isOnline: true, isSyncing: false, waiting: 0, failed: 0, authRequired: false });
  });

  it('is hidden when everything is on the server', async () => {
    await render(<SyncBanner />);
    expect(screen.root).toBeUndefined();
  });

  it('shows what is waiting to sync', async () => {
    useSyncStatus.setState({ waiting: 2 });
    await render(<SyncBanner />);
    expect(screen.getByText('2 inspections waiting to sync')).toBeOnTheScreen();
    expect(screen.queryByText('Log in')).not.toBeOnTheScreen();
  });

  it('offers a new login when the session expired, keeping the unsynced work', async () => {
    useSyncStatus.setState({ waiting: 1, authRequired: true });
    await render(<SyncBanner />);

    await fireEvent.press(screen.getByText('Log in'));

    expect(useAuth.getState().status).toBe('signedOut');
  });
});
