import { apiFetch } from '@/api/client';
import type { BootstrapResponse } from '@/api/types';
import { replaceCache } from '@/db/cacheRepository';

/**
 * Downloads the user's sites and templates and stores them locally (FR-07).
 * Called after login and on pull-to-refresh. Throws ApiError / NetworkError on failure,
 * in which case the existing cache is left untouched.
 */
export async function downloadBootstrap(token: string): Promise<void> {
  const data = await apiFetch<BootstrapResponse>('/api/sync/bootstrap', { token });
  await replaceCache(data);
}
