import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError, NetworkError } from '@/api/client';
import type { SiteInspection } from '@/api/types';
import { useAuth } from '@/auth/authStore';
import { getSiteWithSchedules } from '@/db/cacheRepository';
import { findDraftsForSite, listSubmittedForSite, startOrResumeDraft, type SubmittedInspection } from '@/db/inspectionRepository';
import { fetchSiteHistory } from '@/site/siteApi';
import { retryInspection } from '@/sync/syncManager';
import { useSyncStatus } from '@/sync/syncStatus';
import { setSearchParams } from '@/test/mockExpoRouter';
import { AOIFE, sessionFor, spyOnAlert } from '@/test/helpers';

import SiteScreen from './[id]';

jest.mock('expo-router', () => require('@/test/mockExpoRouter'));
jest.mock('@/notifications/pushNotifications', () => ({}));
jest.mock('@/sync/syncStore', () => ({}));
jest.mock('@/db/cacheRepository', () => ({ getSiteWithSchedules: jest.fn() }));
jest.mock('@/db/inspectionRepository', () => ({
  findDraftsForSite: jest.fn(),
  listSubmittedForSite: jest.fn(),
  startOrResumeDraft: jest.fn(),
}));
jest.mock('@/site/siteApi', () => ({ fetchSiteHistory: jest.fn() }));
jest.mock('@/sync/syncManager', () => ({ retryInspection: jest.fn() }));

const initialAuth = useAuth.getState();

const submitted = (overrides: Partial<SubmittedInspection>): SubmittedInspection => ({
  id: 'mine-1', templateName: 'Scaffold Inspection', status: 'SYNCED', submittedAt: '2026-10-12T09:00:00Z', lastError: null,
  ...overrides,
});
const history = (overrides: Partial<SiteInspection>): SiteInspection => ({
  id: 'h1', templateName: 'Scaffold Inspection', inspectorName: 'Liam O’Brien', submittedAt: '2026-10-05T09:00:00Z',
  itemCount: 6, failCount: 0, failedItems: [],
  ...overrides,
});

/** One site: its checks, this phone's submissions with sync status (FR-24) and the history (FR-09). */
describe('SiteScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setSearchParams({ id: '3' });
    useAuth.setState({ ...initialAuth, status: 'signedIn', session: sessionFor(AOIFE) }, true);
    jest.mocked(getSiteWithSchedules).mockResolvedValue({
      id: 3,
      name: 'Cork Docklands Office Block',
      address: 'Kennedy Quay, Cork',
      schedules: [
        { templateId: 1, templateName: 'Scaffold Inspection', frequencyDays: 7, lastInspectedAt: null },
        { templateId: 2, templateName: 'Lifting Equipment Check', frequencyDays: 30, lastInspectedAt: new Date().toISOString() },
      ],
    });
    jest.mocked(findDraftsForSite).mockResolvedValue(new Map([[2, 'draft-2']]));
    jest.mocked(listSubmittedForSite).mockResolvedValue([]);
    jest.mocked(fetchSiteHistory).mockResolvedValue([]);
  });

  it('shows each check with a button to start it or continue its draft', async () => {
    await render(<SiteScreen />);

    expect(await screen.findByText('Kennedy Quay, Cork')).toBeOnTheScreen();
    expect(getSiteWithSchedules).toHaveBeenCalledWith(3);
    expect(screen.getByText('Every 7 days')).toBeOnTheScreen();
    expect(screen.getByText('Never inspected')).toBeOnTheScreen();
    expect(screen.getByText('Start inspection')).toBeOnTheScreen();
    expect(screen.getByText('Continue draft')).toBeOnTheScreen();
    expect(screen.getByText('No inspections yet.')).toBeOnTheScreen();
  });

  it('starts (or resumes) the draft and opens the checklist', async () => {
    jest.mocked(startOrResumeDraft).mockResolvedValue('new-draft');
    await render(<SiteScreen />);

    await fireEvent.press(await screen.findByText('Start inspection'));

    expect(startOrResumeDraft).toHaveBeenCalledWith(AOIFE.id, 3, 1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/inspection/[id]', params: { id: 'new-draft' } });
  });

  it('explains when the draft cannot be started', async () => {
    const alert = spyOnAlert();
    jest.mocked(startOrResumeDraft).mockRejectedValueOnce(new Error('This site or checklist is no longer on this phone.'));
    await render(<SiteScreen />);

    await fireEvent.press(await screen.findByText('Start inspection'));
    expect(alert).toHaveBeenCalledWith('Could not start inspection', 'This site or checklist is no longer on this phone.');

    jest.mocked(startOrResumeDraft).mockRejectedValueOnce('locked');
    await fireEvent.press(screen.getByText('Start inspection'));
    expect(alert).toHaveBeenLastCalledWith('Could not start inspection', 'locked');
  });

  it('shows the sync status of inspections from this phone, with a retry for failed ones', async () => {
    jest.mocked(listSubmittedForSite).mockResolvedValue([
      submitted({ id: 'mine-1', status: 'FAILED', lastError: 'Item 11 is not in this template' }),
      submitted({ id: 'mine-2', status: 'PENDING', templateName: 'Lifting Equipment Check' }),
    ]);
    await render(<SiteScreen />);

    expect(await screen.findByText('Submitted from this phone')).toBeOnTheScreen();
    expect(screen.getByText('Failed')).toBeOnTheScreen();
    expect(screen.getByText('Item 11 is not in this template')).toBeOnTheScreen();
    expect(screen.getByText('Waiting to sync')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Retry'));
    expect(retryInspection).toHaveBeenCalledWith('mine-1');

    await fireEvent.press(screen.getByText('Waiting to sync')); // anywhere on the row opens it
    expect(router.push).toHaveBeenCalledWith({ pathname: '/inspection/[id]', params: { id: 'mine-2' } });
  });

  it('reloads when sync makes progress, so the statuses update live', async () => {
    await render(<SiteScreen />);
    await screen.findByText('Kennedy Quay, Cork');
    jest.mocked(listSubmittedForSite).mockResolvedValue([submitted({ status: 'SYNCED' })]);

    await act(() => useSyncStatus.setState({ isSyncing: true }));

    expect(await screen.findByText('Synced')).toBeOnTheScreen();
  });

  it("shows colleagues' inspections from the server, without repeating this phone's", async () => {
    jest.mocked(listSubmittedForSite).mockResolvedValue([submitted({ id: 'mine-1', status: 'SYNCING' })]);
    jest.mocked(fetchSiteHistory).mockResolvedValue([
      history({ id: 'mine-1', inspectorName: 'Aoife Murphy' }),
      history({ id: 'h2', failCount: 2, failedItems: ['Guard rails in place', 'Toe boards fitted'] }),
      history({ id: 'h3', templateName: 'Lifting Equipment Check' }),
    ]);
    await render(<SiteScreen />);

    expect(await screen.findByText('2 failed')).toBeOnTheScreen();
    expect(screen.getByText('✗ Guard rails in place')).toBeOnTheScreen();
    expect(screen.getByText('All passed')).toBeOnTheScreen();
    expect(screen.getByText('Syncing')).toBeOnTheScreen();
    expect(screen.queryByText(/Aoife Murphy/)).not.toBeOnTheScreen();
    expect(fetchSiteHistory).toHaveBeenCalledWith(sessionFor(AOIFE).token, 3);
  });

  it.each([
    [new NetworkError(), 'History needs a connection.'],
    [new ApiError(401, 'expired'), 'Log in again to see the history.'],
    [new ApiError(500, 'boom'), 'Could not load the history.'],
  ])('explains when the history cannot be loaded (%p)', async (error, message) => {
    jest.mocked(fetchSiteHistory).mockRejectedValue(error);
    await render(<SiteScreen />);
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.queryByText('No inspections yet.')).not.toBeOnTheScreen();
  });

  it('says so when the site is no longer on this phone', async () => {
    jest.mocked(getSiteWithSchedules).mockResolvedValue(null);
    await render(<SiteScreen />);
    expect(await screen.findByText(/Site not found on this phone/)).toBeOnTheScreen();
  });

  it('loads nothing without a logged-in user', async () => {
    useAuth.setState({ session: null });
    await render(<SiteScreen />);
    expect(getSiteWithSchedules).not.toHaveBeenCalled();
    expect(fetchSiteHistory).not.toHaveBeenCalled();
  });

  it('drops answers that arrive after the screen closed', async () => {
    let answerHistory: (rows: SiteInspection[]) => void = () => {};
    let failHistory: (error: Error) => void = () => {};
    jest.mocked(fetchSiteHistory)
      .mockReturnValueOnce(new Promise((resolve) => (answerHistory = resolve)))
      .mockReturnValueOnce(new Promise((_resolve, reject) => (failHistory = reject)));
    let answerSite: (site: null) => void = () => {};
    jest.mocked(getSiteWithSchedules).mockReturnValueOnce(new Promise((resolve) => (answerSite = resolve)));

    await render(<SiteScreen />);
    await screen.unmount();
    await act(async () => {
      answerSite(null);
      answerHistory([history({})]);
    });
    await render(<SiteScreen />);
    await screen.unmount();
    await act(async () => failHistory(new NetworkError()));

    expect(screen.queryByText(/Site not found/)).not.toBeOnTheScreen();
  });
});
