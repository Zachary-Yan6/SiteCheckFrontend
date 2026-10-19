import type { NotificationResponse } from 'expo-notifications';

/**
 * The in-app route a reminder should open (FR-29), or null if the notification has none.
 * Only app-relative paths ("/site/3") are followed, never full URLs.
 */
export function routeFromNotification(response: NotificationResponse | null): string | null {
  const url = response?.notification.request.content.data?.url;
  return typeof url === 'string' && url.startsWith('/') ? url : null;
}
