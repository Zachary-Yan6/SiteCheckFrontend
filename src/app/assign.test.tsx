import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, type AlertButton, type AlertOptions } from 'react-native';

import { ApiError, NetworkError } from '@/api/client';
import type { User } from '@/api/types';
import { useAuth } from '@/auth/authStore';
import { listSitesWithSchedules } from '@/db/cacheRepository';
import { assignInspector, fetchInspectors, fetchSiteInspectors, unassignInspector } from '@/manager/managerApi';
import { AOIFE, pullToRefresh, SIOBHAN, sessionFor } from '@/test/helpers';

import AssignScreen from './assign';

jest.mock('expo-router', () => require('@/test/mockExpoRouter'));
jest.mock('@/notifications/pushNotifications', () => ({}));
jest.mock('@/sync/syncStore', () => ({}));
jest.mock('@/db/cacheRepository', () => ({ listSitesWithSchedules: jest.fn() }));
jest.mock('@/manager/managerApi', () => ({
  fetchInspectors: jest.fn(),
  fetchSiteInspectors: jest.fn(),
  assignInspector: jest.fn(),
  unassignInspector: jest.fn(),
}));

const initialAuth = useAuth.getState();
const expireSession = jest.fn<() => Promise<void>>();
const token = sessionFor(SIOBHAN).token;
const LIAM: User = { id: 3, email: 'liam.obrien@sitecheck.demo', fullName: 'Liam O’Brien', role: 'INSPECTOR' };

/** Answers every Alert at once by tapping `button` (or dismissing it), and returns the spy. */
function answerAlertsWith(button: string | 'dismiss') {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[], options?: AlertOptions) => {
    if (button === 'dismiss') options?.onDismiss?.();
    else buttons?.find((b) => b.text === button)?.onPress?.();
  });
}

const switchOf = (index: number) => screen.getAllByRole('switch')[index];
const toggle = (index: number, on: boolean) => fireEvent(switchOf(index), 'valueChange', on);

/** Manager: switch inspectors on or off for a site. */
describe('AssignScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.setState({ ...initialAuth, status: 'signedIn', session: sessionFor(SIOBHAN), expireSession }, true);
    jest.mocked(listSitesWithSchedules).mockResolvedValue([
      { id: 5, name: 'Galway Student Residence', address: '', schedules: [] },
      { id: 3, name: 'Cork Docklands Office Block', address: '', schedules: [] },
    ]);
    jest.mocked(fetchInspectors).mockResolvedValue([AOIFE, LIAM]);
    jest.mocked(fetchSiteInspectors).mockResolvedValue([AOIFE]);
    jest.mocked(assignInspector).mockResolvedValue();
    jest.mocked(unassignInspector).mockResolvedValue();
  });

  it('starts on the first site by name and shows who is assigned', async () => {
    await render(<AssignScreen />);

    expect(await screen.findByText('Aoife Murphy')).toBeOnTheScreen();
    expect(fetchSiteInspectors).toHaveBeenCalledWith(token, 3); // Cork comes before Galway
    expect(switchOf(0)).toHaveProp('value', true);
    expect(switchOf(1)).toHaveProp('value', false);

    await fireEvent.press(screen.getByText('Galway Student Residence'));
    expect(fetchSiteInspectors).toHaveBeenLastCalledWith(token, 5);
  });

  it('assigns an inspector straight away', async () => {
    await render(<AssignScreen />);
    await screen.findByText('Liam O’Brien');

    await toggle(1, true);

    expect(assignInspector).toHaveBeenCalledWith(token, 3, LIAM.id);
    expect(switchOf(1)).toHaveProp('value', true);
    expect(switchOf(1)).toHaveProp('disabled', false);
  });

  it('removes an inspector only after a confirmation', async () => {
    const alert = answerAlertsWith('Remove');
    await render(<AssignScreen />);
    await screen.findByText('Aoife Murphy');

    await toggle(0, false);

    expect(alert).toHaveBeenCalledWith('Remove Aoife Murphy from Cork Docklands Office Block?', expect.any(String),
      expect.any(Array), expect.objectContaining({ cancelable: true }));
    expect(unassignInspector).toHaveBeenCalledWith(token, 3, AOIFE.id);
    expect(switchOf(0)).toHaveProp('value', false);
  });

  it.each(['Cancel', 'dismiss'])('keeps the inspector when the confirmation is answered with %s', async (answer) => {
    answerAlertsWith(answer);
    await render(<AssignScreen />);
    await screen.findByText('Aoife Murphy');

    await toggle(0, false);

    expect(unassignInspector).not.toHaveBeenCalled();
    expect(switchOf(0)).toHaveProp('value', true);
  });

  it.each([
    [new NetworkError(), 'No connection - the change was not saved.'],
    [new ApiError(404, 'Inspector not found'), 'Inspector not found'],
    [new Error('boom'), 'Something went wrong. Please try again.'],
  ])('puts the switch back when saving fails (%p)', async (error, message) => {
    const alert = answerAlertsWith('OK');
    jest.mocked(assignInspector).mockRejectedValueOnce(error);
    await render(<AssignScreen />);
    await screen.findByText('Liam O’Brien');

    await toggle(1, true);

    expect(switchOf(1)).toHaveProp('value', false);
    expect(alert).toHaveBeenCalledWith('Not saved', message);
  });

  it('goes back to login when the session expired while saving', async () => {
    jest.mocked(assignInspector).mockRejectedValueOnce(new ApiError(401, 'expired'));
    await render(<AssignScreen />);
    await screen.findByText('Liam O’Brien');

    await toggle(1, true);

    expect(expireSession).toHaveBeenCalled();
  });

  it.each([
    [new NetworkError(), 'Offline - assigning inspectors needs a connection.'],
    [new ApiError(500, 'boom'), 'Could not load inspectors.'],
  ])('explains when the inspectors cannot be loaded (%p)', async (error, message) => {
    jest.mocked(fetchInspectors).mockRejectedValue(error);
    await render(<AssignScreen />);
    expect(await screen.findByText(message)).toBeOnTheScreen();

    await pullToRefresh();
    expect(screen.getByText(message)).toBeOnTheScreen();

    jest.mocked(fetchInspectors).mockResolvedValue([AOIFE]);
    await pullToRefresh();
    expect(screen.queryByText(message)).not.toBeOnTheScreen();
    expect(screen.getByText('Aoife Murphy')).toBeOnTheScreen();
  });

  it('goes back to login when the session expired while loading', async () => {
    jest.mocked(fetchInspectors).mockRejectedValue(new ApiError(401, 'expired'));
    await render(<AssignScreen />);
    await act(async () => {});
    expect(expireSession).toHaveBeenCalledTimes(1);

    await pullToRefresh();
    expect(expireSession).toHaveBeenCalledTimes(2);
  });

  it('says what is missing when there are no sites or no inspectors', async () => {
    jest.mocked(listSitesWithSchedules).mockResolvedValue([]);
    await render(<AssignScreen />);
    expect(await screen.findByText('No sites downloaded yet.')).toBeOnTheScreen();
    await pullToRefresh(); // no site chosen, so nothing to load
    expect(fetchInspectors).not.toHaveBeenCalled();
    await screen.unmount();

    jest.mocked(listSitesWithSchedules).mockResolvedValue([{ id: 3, name: 'Cork', address: '', schedules: [] }]);
    jest.mocked(fetchInspectors).mockResolvedValue([]);
    jest.mocked(fetchSiteInspectors).mockResolvedValue([]);
    await render(<AssignScreen />);
    expect(await screen.findByText('No inspector accounts yet.')).toBeOnTheScreen();
  });

  it('does nothing without a session, and drops answers that arrive after closing', async () => {
    useAuth.setState({ session: null });
    await render(<AssignScreen />);
    await screen.findByText('Cork Docklands Office Block');
    await pullToRefresh();
    expect(fetchInspectors).not.toHaveBeenCalled();
    await screen.unmount();

    // Closed before the site list arrives, then closed before the inspectors arrive (as a 401).
    useAuth.setState({ session: sessionFor(SIOBHAN) });
    let answerSites: (sites: []) => void = () => {};
    jest.mocked(listSitesWithSchedules).mockReturnValueOnce(new Promise((resolve) => (answerSites = resolve)));
    await render(<AssignScreen />);
    await screen.unmount();

    let fail: (error: Error) => void = () => {};
    jest.mocked(fetchInspectors).mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
    await render(<AssignScreen />);
    await screen.unmount();

    await act(async () => {
      answerSites([]);
      fail(new ApiError(401, 'expired'));
    });
    expect(expireSession).not.toHaveBeenCalled();
  });
});
