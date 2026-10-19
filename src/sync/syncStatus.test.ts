import { describe, expect, it } from '@jest/globals';

import { bannerMessage, type SyncStatus } from './syncStatus';

const status = (overrides: Partial<SyncStatus>): SyncStatus => ({
  isOnline: true,
  isSyncing: false,
  waiting: 0,
  failed: 0,
  authRequired: false,
  ...overrides,
});

describe('bannerMessage', () => {
  it('is hidden when online and nothing is waiting', () => {
    expect(bannerMessage(status({}))).toBeNull();
  });

  it('shows the waiting count, also while offline (FR-25)', () => {
    expect(bannerMessage(status({ waiting: 1 }))?.text).toBe('1 inspection waiting to sync');
    expect(bannerMessage(status({ waiting: 3, isOnline: false }))).toEqual({
      text: 'Offline - 3 inspections waiting to sync',
      tone: 'warning',
    });
  });

  it('reassures the user that the app still works offline', () => {
    expect(bannerMessage(status({ isOnline: false }))?.text).toBe('Offline - inspections still work');
  });

  it('puts a needed re-login above everything else', () => {
    expect(bannerMessage(status({ authRequired: true, failed: 1, waiting: 2, isOnline: false }))).toEqual({
      text: 'Session expired. Log in again to upload 2 inspections.',
      tone: 'error',
    });
  });

  it('points to the retry for failed inspections', () => {
    expect(bannerMessage(status({ failed: 2 }))?.tone).toBe('error');
  });
});
