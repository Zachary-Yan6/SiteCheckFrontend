import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';

import { useAuth } from '@/auth/authStore';
import { configureNotifications, registerForPushNotifications } from '@/notifications/pushNotifications';
import { useReminderNavigation } from '@/notifications/useReminderNavigation';
import { startSyncTriggers } from '@/sync/syncManager';
import { AOIFE, SIOBHAN, sessionFor } from '@/test/helpers';

import RootLayout from './_layout';

jest.mock('expo-router', () => require('@/test/mockExpoRouter'));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn() }));
jest.mock('@/notifications/pushNotifications', () => ({
  configureNotifications: jest.fn(),
  registerForPushNotifications: jest.fn(),
}));
jest.mock('@/notifications/useReminderNavigation', () => ({ useReminderNavigation: jest.fn() }));
jest.mock('@/sync/syncManager', () => ({ startSyncTriggers: jest.fn() }));
jest.mock('@/sync/SyncBanner', () => ({ SyncBanner: () => require('react').createElement(require('react-native').Text, null, 'sync banner') }));
jest.mock('@/db/cacheRepository', () => ({}));
jest.mock('@/sync/syncStore', () => ({}));

const initialAuth = useAuth.getState();
const stopSync = jest.fn();
// Made once when the layout module is imported, before any test (and any clearAllMocks) runs.
const callsAtImport = {
  preventAutoHide: jest.mocked(SplashScreen.preventAutoHideAsync).mock.calls.length,
  configureNotifications: jest.mocked(configureNotifications).mock.calls.length,
};

/** Restores the session given, like the app reading it from secure storage at start. */
function startWith(session: ReturnType<typeof sessionFor> | null) {
  useAuth.setState(
    {
      ...initialAuth,
      status: 'loading',
      session: null,
      restore: async () => useAuth.setState(session ? { status: 'signedIn', session } : { status: 'signedOut' }),
    },
    true,
  );
}

const visibleScreens = () => screen.queryAllByText(/^screen:/).map((n) => n.props.children);

/** The root layout: which screens each role gets, and what runs for an inspector. */
describe('RootLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(startSyncTriggers).mockReturnValue(stopSync);
  });

  it('keeps the splash screen up and sets up notifications once, at app start', () => {
    expect(callsAtImport).toEqual({ preventAutoHide: 1, configureNotifications: 1 });
  });

  it('gives an inspector the inspection screens, sync and reminders', async () => {
    startWith(sessionFor(AOIFE));
    await render(<RootLayout />);

    expect(visibleScreens()).toEqual(['screen:index', 'screen:site/[id]', 'screen:inspection/[id]', 'screen:sign/[id]']);
    expect(screen.getByText('sync banner')).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
    expect(startSyncTriggers).toHaveBeenCalled();
    expect(registerForPushNotifications).toHaveBeenCalledWith(sessionFor(AOIFE).token);
    expect(useReminderNavigation).toHaveBeenLastCalledWith(true);
  });

  it('gives a manager the manager screens, without sync or reminders', async () => {
    startWith(sessionFor(SIOBHAN));
    await render(<RootLayout />);

    expect(visibleScreens()).toEqual(['screen:manager', 'screen:assign']);
    expect(screen.queryByText('sync banner')).not.toBeOnTheScreen();
    expect(startSyncTriggers).not.toHaveBeenCalled();
    expect(registerForPushNotifications).not.toHaveBeenCalled();
    expect(useReminderNavigation).toHaveBeenLastCalledWith(false);
  });

  it('shows only login and sign-up when signed out', async () => {
    startWith(null);
    await render(<RootLayout />);
    expect(visibleScreens()).toEqual(['screen:login', 'screen:register']);
  });

  it('stops syncing when the inspector logs out', async () => {
    startWith(sessionFor(AOIFE));
    await render(<RootLayout />);

    await act(() => useAuth.setState({ status: 'signedOut', session: null }));

    expect(stopSync).toHaveBeenCalled();
    expect(visibleScreens()).toEqual(['screen:login', 'screen:register']);
  });

  it('renders nothing while the session is still loading', async () => {
    useAuth.setState({ ...initialAuth, status: 'loading', restore: () => new Promise(() => {}) }, true);
    await render(<RootLayout />);
    expect(screen.root).toBeUndefined();
  });
});
