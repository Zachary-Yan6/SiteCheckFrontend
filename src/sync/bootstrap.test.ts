import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { apiFetch } from '@/api/client';
import { replaceCache } from '@/db/cacheRepository';
import { fetchSiteHistory } from '@/site/siteApi';
import { bootstrap } from '@/test/helpers';

import { downloadBootstrap } from './bootstrap';

jest.mock('@/api/client');
jest.mock('@/db/cacheRepository');

describe('downloadBootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores what the server sends in the offline cache', async () => {
    const data = bootstrap();
    jest.mocked(apiFetch).mockResolvedValueOnce(data);

    await downloadBootstrap('jwt');

    expect(apiFetch).toHaveBeenCalledWith('/api/sync/bootstrap', { token: 'jwt' });
    expect(replaceCache).toHaveBeenCalledWith(data);
  });

  it('leaves the cache alone when the download fails', async () => {
    jest.mocked(apiFetch).mockRejectedValueOnce(new Error('offline'));
    await expect(downloadBootstrap('jwt')).rejects.toThrow('offline');
    expect(replaceCache).not.toHaveBeenCalled();
  });
});

describe('fetchSiteHistory', () => {
  it('asks for the last 30 inspections of the site', async () => {
    jest.mocked(apiFetch).mockResolvedValueOnce([]);
    await fetchSiteHistory('jwt', 3);
    expect(apiFetch).toHaveBeenCalledWith('/api/sites/3/inspections?limit=30', { token: 'jwt' });
  });
});
