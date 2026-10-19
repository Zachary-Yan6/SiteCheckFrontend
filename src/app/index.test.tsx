import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppState, type AppStateStatus } from 'react-native';

import { ApiError, NetworkError } from '@/api/client';
import { useAuth } from '@/auth/authStore';
import { listSitesWithSchedules } from '@/db/cacheRepository';
import type { SiteInput } from '@/schedule/dueStatus';
import { downloadBootstrap } from '@/sync/bootstrap';
import { requestSync } from '@/sync/syncManager';
import { AOIFE, pullToRefresh, sessionFor, spyOnAlert } from '@/test/helpers';

import HomeScreen from './index';

jest.mock('expo-router', () => require('@/test/mockExpoRouter'));
jest.mock('@/notifications/pushNotifications', () => ({}));
jest.mock('@/sync/syncStore', () => ({}));
jest.mock('@/db/cacheRepository', () => ({ listSitesWithSchedules: jest.fn() }));
jest.mock('@/sync/bootstrap', () => ({ downloadBootstrap: jest.fn() }));
jest.mock('@/sync/syncManager', () => ({ requestSync: jest.fn() }));

const initialAuth = useAuth.getState();
const logout = jest.fn<() => Promise<void>>();
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const CORK: SiteInput = {
  id: 3,
  name: 'Cork Docklands Office Block',
  address: 'Kennedy Quay, Cork',
  schedules: [{ templateId: 1, templateName: 'Scaffold Inspection', frequencyDays: 7, lastInspectedAt: daysAgo(10) }],
};
const GALWAY: SiteInput = {
  id: 5,
  name: 'Galway Student Residence',
  address: 'Headford Road, Galway',
  schedules: [{ templateId: 2, templateName: 'Lifting Equipment Check', frequencyDays: 30, lastInspectedAt: daysAgo(0) }],
};

/** FR-08: the inspector's sites from SQLite, most urgent first. */
describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.setState({ ...initialAuth, status: 'signedIn', session: sessionFor(AOIFE), logout }, true);
    jest.mocked(listSitesWithSchedules).mockResolvedValue([GALWAY, CORK]);
    jest.mocked(requestSync).mockResolvedValue();
    jest.mocked(downloadBootstrap).mockResolvedValue();
    logout.mockResolvedValue();
  });

  it('lists the sites with the most urgent first', async () => {
    await render(<HomeScreen />);

    expect(await screen.findByText('Hi Aoife Murphy')).toBeOnTheScreen();
    const names = screen.getAllByText(/Cork Docklands|Galway Student/).map((n) => n.props.children);
    expect(names).toEqual(['Cork Docklands Office Block', 'Galway Student Residence']);
    expect(screen.getByText('Overdue 3 days')).toBeOnTheScreen();
    expect(screen.getByText('Scaffold Inspection · Overdue 3 days')).toBeOnTheScreen();
    expect(screen.getByText('Lifting Equipment Check · Due in 30 days')).toBeOnTheScreen();
  });

  it('opens a site when tapped', async () => {
    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByText('Cork Docklands Office Block'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/site/[id]', params: { id: '3' } });
  });

  it('tells a new inspector how to get sites', async () => {
    jest.mocked(listSitesWithSchedules).mockResolvedValue([]);
    await render(<HomeScreen />);
    expect(await screen.findByText(/No sites assigned to you yet/)).toBeOnTheScreen();
  });

  it('pull-to-refresh uploads waiting work, then downloads the sites again', async () => {
    await render(<HomeScreen />);
    jest.mocked(listSitesWithSchedules).mockResolvedValue([CORK]);

    await pullToRefresh();

    expect(requestSync).toHaveBeenCalled();
    expect(downloadBootstrap).toHaveBeenCalledWith(sessionFor(AOIFE).token);
    expect(screen.queryByText('Galway Student Residence')).not.toBeOnTheScreen();
  });

  it.each([
    [new NetworkError(), 'Offline - showing saved sites.'],
    [new ApiError(401, 'expired'), 'Session expired - log in again to refresh.'],
    [new ApiError(500, 'boom'), 'Could not refresh. Showing saved sites.'],
  ])('keeps the saved sites when refreshing fails (%p)', async (error, message) => {
    jest.mocked(downloadBootstrap).mockRejectedValueOnce(error);
    await render(<HomeScreen />);

    await pullToRefresh();

    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(screen.getByText('Cork Docklands Office Block')).toBeOnTheScreen();
  });

  it('cannot refresh without a session', async () => {
    useAuth.setState({ session: null });
    await render(<HomeScreen />);
    await pullToRefresh();
    expect(requestSync).not.toHaveBeenCalled();
  });

  it('logs out, or explains why it cannot', async () => {
    const alert = spyOnAlert();
    await render(<HomeScreen />);

    await fireEvent.press(screen.getByText('Log out'));
    expect(logout).toHaveBeenCalled();

    logout.mockRejectedValueOnce(new Error("1 inspection(s) haven't reached the server yet."));
    await fireEvent.press(screen.getByText('Log out'));
    expect(alert).toHaveBeenCalledWith('Not logged out', "1 inspection(s) haven't reached the server yet.");

    logout.mockRejectedValueOnce('locked');
    await fireEvent.press(screen.getByText('Log out'));
    expect(alert).toHaveBeenLastCalledWith('Not logged out', 'locked');
  });

  it('re-reads the clock when the app comes back to the foreground', async () => {
    let onChange: (state: AppStateStatus) => void = () => {};
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onChange = listener;
      return { remove };
    });
    await render(<HomeScreen />);

    await act(() => onChange('background'));
    await act(() => onChange('active'));
    expect(screen.getByText('Overdue 3 days')).toBeOnTheScreen();

    await screen.unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('ignores the database answer if the screen has already closed', async () => {
    let answer: (sites: SiteInput[]) => void = () => {};
    jest.mocked(listSitesWithSchedules).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render(<HomeScreen />);

    await screen.unmount();
    await act(async () => answer([CORK]));

    expect(screen.queryByText('Cork Docklands Office Block')).not.toBeOnTheScreen();
  });
});
