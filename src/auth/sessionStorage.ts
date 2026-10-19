import * as SecureStore from 'expo-secure-store';

import type { User } from '@/api/types';

/** What we keep about the logged-in user. Stored in the Android Keystore / iOS Keychain (FR-01). */
export interface Session {
  token: string;
  expiresAt: string;
  user: User;
}

const KEY = 'sitecheck.session';

export async function loadSession(): Promise<Session | null> {
  const json = await SecureStore.getItemAsync(KEY);
  if (!json) return null;
  try {
    return JSON.parse(json) as Session;
  } catch {
    return null; // corrupted - treat as logged out
  }
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
