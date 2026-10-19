import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { apiFetch } from '@/api/client';
import { Notifications } from '@/notifications/notificationsModule';

/*
 * Push reminders (FR-27 to FR-29). The backend sends one notification per site every morning
 * for checks that are overdue, due today or due tomorrow; tapping it opens that site.
 *
 * Remote push needs a development or release build - Expo Go on Android no longer supports it -
 * and an EAS project id (from `eas init`). Without either, registration is skipped quietly and
 * everything else in the app works as before.
 */

/** Must match ANDROID_CHANNEL in the backend's ReminderService. */
const REMINDER_CHANNEL = 'reminders';
const STORED_TOKEN_KEY = 'sitecheck.pushToken';

/** Call once at app start: how notifications look while the app is open, and the Android channel. */
export function configureNotifications(): void {
  if (!Notifications) return; // Expo Go on Android: no push
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    // On Android 13+ the channel must exist before asking for a token, or no permission prompt appears.
    Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
      name: 'Inspection reminders',
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => {});
  }
}

/**
 * FR-27: asks for permission, gets this phone's Expo push token and registers it for the logged-in
 * user. Safe to call on every app start (the backend upserts). Never throws: without permission,
 * signal or a push-capable build, the user simply gets no reminders.
 */
export async function registerForPushNotifications(sessionToken: string): Promise<void> {
  if (!Notifications) return;
  try {
    if (!Device.isDevice) return; // emulators/simulators can't receive remote push reliably

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.info('Push reminders off: no EAS project id yet (run `eas init`).');
      return;
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return;

    const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await apiFetch('/api/devices', {
      method: 'POST',
      body: { token: pushToken, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
      token: sessionToken,
    });
    await SecureStore.setItemAsync(STORED_TOKEN_KEY, pushToken);
  } catch (error) {
    console.info('Push registration skipped for now:', error); // retried on next app start
  }
}

/** On logout: stop reminders for this phone. Best effort - offline it just stays registered. */
export async function unregisterPushNotifications(sessionToken: string): Promise<void> {
  const pushToken = await SecureStore.getItemAsync(STORED_TOKEN_KEY);
  if (!pushToken) return;
  try {
    await apiFetch(`/api/devices/${encodeURIComponent(pushToken)}`, { method: 'DELETE', token: sessionToken });
    await SecureStore.deleteItemAsync(STORED_TOKEN_KEY);
  } catch {
    // Offline: the next user to log in on this phone takes the token over anyway.
  }
}
