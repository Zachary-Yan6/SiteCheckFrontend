import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import { apiFetch } from '@/api/client';
import { clearSession, loadSession, saveSession } from '@/auth/sessionStorage';
import { clearCache } from '@/db/cacheRepository';
import { unregisterPushNotifications } from '@/notifications/pushNotifications';
import { downloadBootstrap } from '@/sync/bootstrap';
import { syncCounts } from '@/sync/syncStore';
import { AOIFE, sessionFor } from '@/test/helpers';

import { useAuth, useCurrentUser } from './authStore';

jest.mock('@/api/client', () => ({ ...jest.requireActual<object>('@/api/client'), apiFetch: jest.fn() }));
jest.mock('@/auth/sessionStorage');
jest.mock('@/db/cacheRepository');
jest.mock('@/notifications/pushNotifications', () => ({ unregisterPushNotifications: jest.fn() }));
jest.mock('@/sync/bootstrap');
jest.mock('@/sync/syncStore');

const session = sessionFor(AOIFE);
const loginResponse = { token: session.token, expiresAt: session.expiresAt, user: AOIFE };

describe('useAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.setState({ status: 'loading', session: null });
    jest.mocked(syncCounts).mockResolvedValue({ waiting: 0, failed: 0 });
  });

  it('restores a saved session on start, even offline', async () => {
    jest.mocked(loadSession).mockResolvedValue(session);
    await useAuth.getState().restore();
    expect(useAuth.getState()).toMatchObject({ status: 'signedIn', session });
  });

  it('is signed out on start without a saved session', async () => {
    jest.mocked(loadSession).mockResolvedValue(null);
    await useAuth.getState().restore();
    expect(useAuth.getState()).toMatchObject({ status: 'signedOut', session: null });
  });

  it('logs in, fills the offline cache, then saves the session', async () => {
    jest.mocked(apiFetch).mockResolvedValue(loginResponse);

    await useAuth.getState().login('aoife.murphy@sitecheck.demo', 'Password123!');

    expect(apiFetch).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      body: { email: 'aoife.murphy@sitecheck.demo', password: 'Password123!' },
    });
    expect(downloadBootstrap).toHaveBeenCalledWith(session.token);
    expect(saveSession).toHaveBeenCalledWith(session);
    expect(useAuth.getState()).toMatchObject({ status: 'signedIn', session });
  });

  it('does not count as logged in when the download fails', async () => {
    jest.mocked(apiFetch).mockResolvedValue(loginResponse);
    jest.mocked(downloadBootstrap).mockRejectedValueOnce(new Error('offline'));

    await expect(useAuth.getState().login('a@b.c', 'x')).rejects.toThrow('offline');
    expect(saveSession).not.toHaveBeenCalled();
    expect(useAuth.getState().status).toBe('loading');
  });

  it('registers and continues like a login', async () => {
    jest.mocked(apiFetch).mockResolvedValue(loginResponse);

    await useAuth.getState().register('new@sitecheck.demo', 'Password123!', 'New Person');

    expect(apiFetch).toHaveBeenCalledWith('/api/auth/register', {
      method: 'POST',
      body: { email: 'new@sitecheck.demo', password: 'Password123!', fullName: 'New Person' },
    });
    expect(useAuth.getState().status).toBe('signedIn');
  });

  it('logs out: stops reminders and wipes the session and cache', async () => {
    useAuth.setState({ status: 'signedIn', session });

    await useAuth.getState().logout();

    expect(unregisterPushNotifications).toHaveBeenCalledWith(session.token);
    expect(clearSession).toHaveBeenCalled();
    expect(clearCache).toHaveBeenCalled();
    expect(useAuth.getState()).toMatchObject({ status: 'signedOut', session: null });
  });

  it('refuses to log out while inspections are not on the server yet (FR-04)', async () => {
    useAuth.setState({ status: 'signedIn', session });
    jest.mocked(syncCounts).mockResolvedValue({ waiting: 1, failed: 1 });

    await expect(useAuth.getState().logout()).rejects.toThrow("2 inspection(s) haven't reached the server yet");
    expect(clearSession).not.toHaveBeenCalled();
    expect(useAuth.getState().status).toBe('signedIn');
  });

  it('logout without a session just clears what is left', async () => {
    useAuth.setState({ status: 'signedOut', session: null });
    await useAuth.getState().logout();
    expect(syncCounts).not.toHaveBeenCalled();
    expect(clearCache).toHaveBeenCalled();
  });

  it('an expired session forgets the token but keeps the cache and unsynced work', async () => {
    useAuth.setState({ status: 'signedIn', session });
    await useAuth.getState().expireSession();
    expect(clearSession).toHaveBeenCalled();
    expect(clearCache).not.toHaveBeenCalled();
    expect(useAuth.getState().status).toBe('signedOut');
  });

  it('useCurrentUser gives the logged-in user, or null', async () => {
    useAuth.setState({ status: 'signedIn', session });
    const { result } = await renderHook(() => useCurrentUser());
    expect(result.current).toEqual(AOIFE);

    await act(() => useAuth.setState({ status: 'signedOut', session: null }));
    expect(result.current).toBeNull();
  });
});
