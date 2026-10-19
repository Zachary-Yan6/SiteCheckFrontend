import type { NotificationResponse } from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { Notifications } from '@/notifications/notificationsModule';
import { routeFromNotification } from '@/notifications/routeFromNotification';

/**
 * FR-29: tapping a reminder opens its site. Handles both a tap that launched the app from closed
 * and taps while it is running. Only active while an inspector is logged in, so the site screen
 * exists to navigate to.
 */
export function useReminderNavigation(enabled: boolean): void {
  useEffect(() => {
    const notifications = Notifications; // local copy so the null check also holds inside open()
    if (!enabled || !notifications) return;
    let active = true;

    const open = (response: NotificationResponse | null) => {
      const route = routeFromNotification(response);
      if (!route) return;
      router.push(route as Href);
      // Otherwise the same tap would be "last response" again after the next login.
      notifications.clearLastNotificationResponseAsync().catch(() => {});
    };

    notifications.getLastNotificationResponseAsync().then((response) => {
      if (active) open(response);
    });
    const subscription = notifications.addNotificationResponseReceivedListener(open);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [enabled]);
}
