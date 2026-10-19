import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { apiFetch, NetworkError } from '@/api/client';
import { API_URL } from '@/config';

import {
  assignInspector,
  fetchFailedItems,
  fetchInspectors,
  fetchSiteInspectors,
  localIsoDate,
  shareSiteReport,
  unassignInspector,
} from './managerApi';

jest.mock('@/api/client', () => ({ ...jest.requireActual<object>('@/api/client'), apiFetch: jest.fn() }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => {
  const File = jest.fn((dir: string, name: string) => ({ uri: `${dir}/${name}` }));
  Object.assign(File, { downloadFileAsync: jest.fn() });
  return { File, Paths: { cache: 'file:///cache' } };
});

const downloadFileAsync = (File as unknown as { downloadFileAsync: jest.Mock<(...args: unknown[]) => Promise<unknown>> })
  .downloadFileAsync;

describe('localIsoDate', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // 00:30 on 1 July in Ireland is still 30 June in UTC.
    expect(localIsoDate(new Date('2026-07-01T00:30:00+01:00'))).toBe('2026-07-01');
  });

  it('pads month and day', () => {
    expect(localIsoDate(new Date('2026-03-05T12:00:00'))).toBe('2026-03-05');
  });
});

describe('manager endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: new Date('2026-10-13T10:00:00+01:00') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks for failed items since N days ago, for all sites or one', async () => {
    await fetchFailedItems('jwt', 30, null);
    await fetchFailedItems('jwt', 7, 3);

    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/manager/failed-items?from=2026-09-13', { token: 'jwt' });
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/manager/failed-items?from=2026-10-06&siteId=3', { token: 'jwt' });
  });

  it('lists inspectors and assigns or removes them', async () => {
    await fetchInspectors('jwt');
    await fetchSiteInspectors('jwt', 3);
    await assignInspector('jwt', 3, 2);
    await unassignInspector('jwt', 3, 2);

    expect(jest.mocked(apiFetch).mock.calls).toEqual([
      ['/api/manager/inspectors', { token: 'jwt' }],
      ['/api/manager/sites/3/inspectors', { token: 'jwt' }],
      ['/api/manager/sites/3/inspectors/2', { method: 'PUT', token: 'jwt' }],
      ['/api/manager/sites/3/inspectors/2', { method: 'DELETE', token: 'jwt' }],
    ]);
  });

  it('downloads the PDF report and opens the share sheet', async () => {
    await shareSiteReport('jwt', 3, 30);

    expect(downloadFileAsync).toHaveBeenCalledWith(
      `${API_URL}/api/manager/sites/3/report?from=2026-09-13`,
      { uri: 'file:///cache/sitecheck-site-3-from-2026-09-13.pdf' },
      { headers: { Authorization: 'Bearer jwt' }, idempotent: true },
    );
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/sitecheck-site-3-from-2026-09-13.pdf', {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Share inspection report',
    });
  });

  it('reports a failed download as a connection problem and shares nothing', async () => {
    downloadFileAsync.mockRejectedValueOnce(new Error('timeout'));
    await expect(shareSiteReport('jwt', 3, 30)).rejects.toBeInstanceOf(NetworkError);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});
