import { create } from 'zustand';

import { apiFetch } from '@/api/client';
import type { LoginResponse, User } from '@/api/types';
import { clearSession, loadSession, saveSession, type Session } from '@/auth/sessionStorage';
import { clearCache } from '@/db/cacheRepository';
import { unregisterPushNotifications } from '@/notifications/pushNotifications';
import { downloadBootstrap } from '@/sync/bootstrap';
import { syncCounts } from '@/sync/syncStore';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: Status;
  session: Session | null;
  /** On app start: read the saved session. Works fully offline. */
  restore: () => Promise<void>;
  /** Needs a connection: log in, then download sites/templates so the app works offline. */
  login: (email: string, password: string) => Promise<void>;
  /** Needs a connection: create an INSPECTOR account, then continue exactly like login. */
  register: (email: string, password: string, fullName: string) => Promise<void>;
  /** Throws if this user still has inspections that haven't reached the server (FR-04). */
  logout: () => Promise<void>;
  /**
   * The server rejected the token (FR-03): forget the token and show the login screen, but keep
   * everything else - cached sites and, above all, unsynced inspections - for after the re-login.
   */
  expireSession: () => Promise<void>;
}

/**
 * Login state. Zustand holds only UI state like this - business data lives in SQLite.
 *
 * FR-03: a saved session is trusted on startup even if the token has expired, because the
 * phone may be offline in a basement. The server will answer 401 once we're back online,
 * and that is when we'll ask the user to log in again (without losing unsynced work).
 */
export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,

  restore: async () => {
    const session = await loadSession();
    set(session ? { status: 'signedIn', session } : { status: 'signedOut', session: null });
  },

  login: async (email, password) => {
    const response = await apiFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    set(await startSession(response));
  },

  register: async (email, password, fullName) => {
    // The backend answers sign-up with the same body as login.
    const response = await apiFetch<LoginResponse>('/api/auth/register', {
      method: 'POST',
      body: { email, password, fullName },
    });
    set(await startSession(response));
  },

  logout: async () => {
    const session = get().session;
    if (session) {
      const { waiting, failed } = await syncCounts(session.user.id);
      if (waiting + failed > 0) {
        throw new Error(
          `${waiting + failed} inspection(s) haven't reached the server yet. Stay logged in until they sync.`,
        );
      }
      // No more reminders on this phone for this user (best effort, works offline too).
      await unregisterPushNotifications(session.token);
    }
    await clearSession();
    await clearCache();
    set({ status: 'signedOut', session: null });
  },

  expireSession: async () => {
    await clearSession();
    set({ status: 'signedOut', session: null });
  },
}));

/** After login or sign-up: fill the offline cache, then remember the session. */
async function startSession(response: LoginResponse): Promise<Pick<AuthState, 'status' | 'session'>> {
  // Download before saving the session: a user who is "logged in" with an empty cache
  // couldn't do anything once they lose signal.
  await downloadBootstrap(response.token);
  const session: Session = { token: response.token, expiresAt: response.expiresAt, user: response.user };
  await saveSession(session);
  return { status: 'signedIn', session };
}

export function useCurrentUser(): User | null {
  return useAuth((state) => state.session?.user ?? null);
}
