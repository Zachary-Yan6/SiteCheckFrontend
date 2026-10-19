import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

/**
 * expo-notifications, or null where it can't load. Expo Go on Android (SDK 53+) throws as soon as
 * the module is imported, so it is only required in builds that support remote push.
 */
export const Notifications: NotificationsModule | null =
  Platform.OS === 'android' && isRunningInExpoGo()
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('expo-notifications');
