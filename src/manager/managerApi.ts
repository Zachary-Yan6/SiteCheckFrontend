import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { apiFetch, NetworkError } from '@/api/client';
import type { FailedItem, User } from '@/api/types';
import { API_URL } from '@/config';

/**
 * Failed items of the last `days` days, optionally for one site (FR-30). Unlike the inspector's
 * screens this reads straight from the server: managers look at results, they don't capture
 * them in a basement, so their page is deliberately online-only and kept light.
 */
export function fetchFailedItems(token: string, days: number, siteId: number | null): Promise<FailedItem[]> {
  const from = new Date();
  from.setDate(from.getDate() - days);
  const params = new URLSearchParams({ from: localIsoDate(from) });
  if (siteId !== null) params.set('siteId', String(siteId));
  return apiFetch<FailedItem[]>(`/api/manager/failed-items?${params}`, { token });
}

/**
 * Downloads the PDF report of one site for the last `days` days (FR-31) and opens the share
 * sheet, so the manager can save it, print it or email it for an audit.
 */
export async function shareSiteReport(token: string, siteId: number, days: number): Promise<void> {
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromDate = localIsoDate(from);
  const target = new File(Paths.cache, `sitecheck-site-${siteId}-from-${fromDate}.pdf`);

  try {
    await File.downloadFileAsync(`${API_URL}/api/manager/sites/${siteId}/report?from=${fromDate}`, target, {
      headers: { Authorization: `Bearer ${token}` },
      idempotent: true, // replace an earlier download of the same report
    });
  } catch {
    throw new NetworkError('Could not download the report. Check the connection and try again.');
  }

  await Sharing.shareAsync(target.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: 'Share inspection report',
  });
}

/** Every inspector account, including new sign-ups with no sites yet. */
export function fetchInspectors(token: string): Promise<User[]> {
  return apiFetch<User[]>('/api/manager/inspectors', { token });
}

/** Inspectors currently assigned to one site. */
export function fetchSiteInspectors(token: string, siteId: number): Promise<User[]> {
  return apiFetch<User[]>(`/api/manager/sites/${siteId}/inspectors`, { token });
}

/** Safe to repeat: assigning someone already on the site changes nothing. */
export function assignInspector(token: string, siteId: number, userId: number): Promise<void> {
  return apiFetch<void>(`/api/manager/sites/${siteId}/inspectors/${userId}`, { method: 'PUT', token });
}

/** Safe to repeat: removing someone not on the site changes nothing. */
export function unassignInspector(token: string, siteId: number, userId: number): Promise<void> {
  return apiFetch<void>(`/api/manager/sites/${siteId}/inspectors/${userId}`, { method: 'DELETE', token });
}

/** YYYY-MM-DD in the phone's own time zone (toISOString would give the UTC date). */
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
