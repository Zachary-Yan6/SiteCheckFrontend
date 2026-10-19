import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError, NetworkError } from '@/api/client';
import type { FailedItem } from '@/api/types';
import { useAuth } from '@/auth/authStore';
import { listSitesWithSchedules } from '@/db/cacheRepository';
import { fetchFailedItems, shareSiteReport } from '@/manager/managerApi';
import { pullToRefresh, SIOBHAN, sessionFor, spyOnAlert } from '@/test/helpers';

import ManagerScreen from './manager';

jest.mock('expo-router', () => require('@/test/mockExpoRouter'));
jest.mock('@/notifications/pushNotifications', () => ({}));
jest.mock('@/sync/syncStore', () => ({}));
jest.mock('@/db/cacheRepository', () => ({ listSitesWithSchedules: jest.fn() }));
jest.mock('@/manager/managerApi', () => ({ fetchFailedItems: jest.fn(), shareSiteReport: jest.fn() }));

const initialAuth = useAuth.getState();
const logout = jest.fn<() => Promise<void>>();
const expireSession = jest.fn<() => Promise<void>>();
const token = sessionFor(SIOBHAN).token;

const failedItem: FailedItem = {
  inspectionId: 'i1', siteId: 3, siteName: 'Cork Docklands Office Block', templateName: 'Scaffold Inspection',
  position: 2, itemTitle: 'Guard rails in place', note: 'Missing on level 3', submittedAt: '2026-10-12T09:00:00Z',
  inspectorName: 'Aoife Murphy',
  photos: [{ id: 'p1', url: 'https://s3.test/p1.jpg?sig', takenAt: '2026-10-12T08:55:00Z', latitude: null, longitude: null }],
};

const images = () => screen.container.queryAll((node) => node.type === 'Image');

/** FR-30/31: failed items across sites, filters, photos and the PDF report. Online only. */
describe('ManagerScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.setState({ ...initialAuth, status: 'signedIn', session: sessionFor(SIOBHAN), logout, expireSession }, true);
    jest.mocked(listSitesWithSchedules).mockResolvedValue([
      { id: 5, name: 'Galway Student Residence', address: '', schedules: [] },
      { id: 3, name: 'Cork Docklands Office Block', address: '', schedules: [] },
    ]);
    jest.mocked(fetchFailedItems).mockResolvedValue([failedItem]);
    jest.mocked(shareSiteReport).mockResolvedValue();
    logout.mockResolvedValue();
  });

  it('lists failed items of the last 30 days across all sites', async () => {
    await render(<ManagerScreen />);

    expect(await screen.findByText('Guard rails in place')).toBeOnTheScreen();
    expect(screen.getByText('Hi Siobhan Kelly')).toBeOnTheScreen();
    expect(screen.getByText('Scaffold Inspection · item 2')).toBeOnTheScreen();
    expect(screen.getByText('Missing on level 3')).toBeOnTheScreen();
    expect(fetchFailedItems).toHaveBeenCalledWith(token, 30, null);
    expect(screen.getByText('Choose a site to export a PDF report')).toBeDisabled();
  });

  it('filters by period and site, sites sorted by name', async () => {
    await render(<ManagerScreen />);
    const siteChips = (await screen.findAllByText(/Docklands|Student Residence/)).map((n) => n.props.children);
    expect(siteChips).toEqual(['Cork Docklands Office Block', 'Galway Student Residence', 'Cork Docklands Office Block']);

    await fireEvent.press(screen.getByText('7 days'));
    expect(fetchFailedItems).toHaveBeenLastCalledWith(token, 7, null);

    await fireEvent.press(screen.getByText('Galway Student Residence'));
    expect(fetchFailedItems).toHaveBeenLastCalledWith(token, 7, 5);

    await fireEvent.press(screen.getByText('All sites'));
    expect(fetchFailedItems).toHaveBeenLastCalledWith(token, 7, null);
  });

  it('exports the PDF report of the chosen site', async () => {
    await render(<ManagerScreen />);
    await fireEvent.press(await screen.findByText('Galway Student Residence'));

    await fireEvent.press(screen.getByText('PDF report - last 30 days'));

    expect(shareSiteReport).toHaveBeenCalledWith(token, 5, 30);
    expect(screen.getByText('PDF report - last 30 days')).toBeEnabled();
  });

  it('explains a failed export', async () => {
    const alert = spyOnAlert();
    jest.mocked(shareSiteReport).mockRejectedValueOnce(new NetworkError('Could not download the report.'));
    await render(<ManagerScreen />);
    await fireEvent.press(await screen.findByText('Galway Student Residence'));

    await fireEvent.press(screen.getByText('PDF report - last 30 days'));
    expect(alert).toHaveBeenCalledWith('No report', 'Could not download the report.');

    jest.mocked(shareSiteReport).mockRejectedValueOnce('cancelled');
    await fireEvent.press(screen.getByText('PDF report - last 30 days'));
    expect(alert).toHaveBeenLastCalledWith('No report', 'cancelled');
  });

  it('opens a photo full screen, and closes it with a tap or the back button', async () => {
    await render(<ManagerScreen />);
    await screen.findByText('Guard rails in place');
    expect(images()).toHaveLength(1);

    await fireEvent.press(images()[0]);
    expect(images()).toHaveLength(2);
    await fireEvent.press(images()[1]);
    expect(images()).toHaveLength(1);

    await fireEvent.press(images()[0]);
    const [modal] = screen.container.queryAll((node) => typeof node.props.onRequestClose === 'function');
    await act(() => modal.props.onRequestClose());
    expect(images()).toHaveLength(1);
  });

  it('shows an item without note or photos, and an empty list', async () => {
    jest.mocked(fetchFailedItems).mockResolvedValue([{ ...failedItem, note: null, photos: [] }]);
    await render(<ManagerScreen />);
    expect(await screen.findByText('Guard rails in place')).toBeOnTheScreen();
    expect(images()).toHaveLength(0);

    jest.mocked(fetchFailedItems).mockResolvedValue([]);
    await pullToRefresh();
    expect(screen.getByText('No failed items in the last 30 days.')).toBeOnTheScreen();
  });

  it.each([
    [new NetworkError(), 'Offline - the manager view needs a connection.'],
    [new ApiError(500, 'boom'), 'Could not load failed items.'],
  ])('explains when the list cannot be loaded (%p)', async (error, message) => {
    jest.mocked(fetchFailedItems).mockRejectedValue(error);
    await render(<ManagerScreen />);
    expect(await screen.findByText(message)).toBeOnTheScreen();

    await pullToRefresh();
    expect(screen.getByText(message)).toBeOnTheScreen();

    jest.mocked(fetchFailedItems).mockResolvedValue([failedItem]);
    await pullToRefresh();
    expect(screen.queryByText(message)).not.toBeOnTheScreen();
  });

  it('goes back to login when the session has expired', async () => {
    jest.mocked(fetchFailedItems).mockRejectedValue(new ApiError(401, 'expired'));
    await render(<ManagerScreen />);
    await act(async () => {});
    expect(expireSession).toHaveBeenCalledTimes(1);

    await pullToRefresh();
    expect(expireSession).toHaveBeenCalledTimes(2);
  });

  it('logs out from the header, or explains why it cannot', async () => {
    const alert = spyOnAlert();
    await render(<ManagerScreen />);

    await fireEvent.press(screen.getByText('Log out'));
    expect(logout).toHaveBeenCalled();

    logout.mockRejectedValueOnce(new Error('Keychain locked'));
    await fireEvent.press(screen.getByText('Log out'));
    expect(alert).toHaveBeenCalledWith('Not logged out', 'Keychain locked');

    logout.mockRejectedValueOnce('locked');
    await fireEvent.press(screen.getByText('Log out'));
    expect(alert).toHaveBeenLastCalledWith('Not logged out', 'locked');
  });

  it('links to assigning inspectors', async () => {
    await render(<ManagerScreen />);
    await fireEvent.press(screen.getByText('Assign inspectors to sites'));
    expect(router.push).toHaveBeenCalledWith('/assign');
  });

  it('loads nothing without a session, and drops answers that arrive after closing', async () => {
    useAuth.setState({ session: null });
    await render(<ManagerScreen />);
    await pullToRefresh();
    await fireEvent.press(await screen.findByText('Galway Student Residence'));
    expect(fetchFailedItems).not.toHaveBeenCalled();
    await screen.unmount();

    useAuth.setState({ session: sessionFor(SIOBHAN) });
    let answer: (items: FailedItem[]) => void = () => {};
    let fail: (error: Error) => void = () => {};
    jest.mocked(fetchFailedItems)
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
    let answerSites: (sites: []) => void = () => {};
    jest.mocked(listSitesWithSchedules).mockReturnValueOnce(new Promise((resolve) => (answerSites = resolve)));
    await render(<ManagerScreen />);
    await screen.unmount();
    await render(<ManagerScreen />);
    await screen.unmount();
    await act(async () => {
      answer([failedItem]);
      fail(new NetworkError());
      answerSites([]);
    });
    expect(expireSession).not.toHaveBeenCalled();
  });
});
