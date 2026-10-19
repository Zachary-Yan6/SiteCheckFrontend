import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';

import { AOIFE, sessionFor } from '@/test/helpers';

import { clearSession, loadSession, saveSession } from './sessionStorage';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});

describe('sessionStorage', () => {
  beforeEach(async () => {
    await clearSession();
  });

  it('saves, loads and clears the session in secure storage', async () => {
    const session = sessionFor(AOIFE);
    await saveSession(session);
    expect(await loadSession()).toEqual(session);

    await clearSession();
    expect(await loadSession()).toBeNull();
  });

  it('treats a corrupted entry as logged out', async () => {
    await SecureStore.setItemAsync('sitecheck.session', '{not json');
    expect(await loadSession()).toBeNull();
  });
});
