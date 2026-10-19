import { apiFetch } from '@/api/client';
import type { SiteInspection } from '@/api/types';

/**
 * The site's recent inspections by anyone, from the server (FR-09). Online only: history is
 * for looking things up, not for capturing work, so it isn't worth caching on the phone.
 */
export function fetchSiteHistory(token: string, siteId: number): Promise<SiteInspection[]> {
  return apiFetch<SiteInspection[]>(`/api/sites/${siteId}/inspections?limit=30`, { token });
}
