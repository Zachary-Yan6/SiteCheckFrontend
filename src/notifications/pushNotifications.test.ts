import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { apiFetch } from '@/api/client';

import { configureNotifications, registerForPushNotifications, unregisterPushNotifications } from './pushNotifications';

/** A fake expo-notifications; set to null to act like Expo Go on Android, where it can't load. */
const mockNotifications = {
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[phone]' })),
  AndroidImportance: { HIGH: 4 },
};
let mockAvailable = true;

jest.mock('./notificationsModule', () => ({
  get Notifications() {
    return mockAvailable ? mockNotifications : null;
  },
}));
jest.mock('@/api/client', () => ({ apiFetch: jest.fn() }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('push notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAvailable = true;
    jest.replaceProperty(Device, 'isDevice', true);
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('configureNotifications', () => {
    it('shows reminders while the app is open and creates the Android channel', async () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      configureNotifications();

      const handler = mockNotifications.setNotificationHandler.mock.calls[0][0] as {
        handleNotification: () => Promise<unknown>;
      };
      await expect(handler.handleNotification()).resolves.toMatchObject({ shouldShowBanner: true, shouldSetBadge: false });
      expect(mockNotifications.setNotificationChannelAsync).toHaveBeenCalledWith('reminders', {
        name: 'Inspection reminders',
        importance: 4,
      });
    });

    it('needs no channel on iOS, and does nothing where push is unavailable', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      configureNotifications();
      expect(mockNotifications.setNotificationChannelAsync).not.toHaveBeenCalled();

      mockAvailable = false;
      configureNotifications();
      expect(mockNotifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('registerForPushNotifications', () => {
    it('asks for permission, then registers this phone for the user', async () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      mockNotifications.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' });

      await registerForPushNotifications('jwt');

      expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalled();
      expect(mockNotifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
      expect(apiFetch).toHaveBeenCalledWith('/api/devices', {
        method: 'POST',
        body: { token: 'ExponentPushToken[phone]', platform: 'ios' },
        token: 'jwt',
      });
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith('sitecheck.pushToken', 'ExponentPushToken[phone]');
    });

    it('sends the android platform from an Android phone', async () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      await registerForPushNotifications('jwt');
      expect(apiFetch).toHaveBeenCalledWith('/api/devices', expect.objectContaining({
        body: { token: 'ExponentPushToken[phone]', platform: 'android' },
      }));
    });

    it('registers nothing without permission, on an emulator, or without push support', async () => {
      mockNotifications.getPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
      mockNotifications.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
      await registerForPushNotifications('jwt');

      jest.replaceProperty(Device, 'isDevice', false);
      await registerForPushNotifications('jwt');

      mockAvailable = false;
      await registerForPushNotifications('jwt');

      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('skips quietly without an EAS project id', async () => {
      jest.replaceProperty(Constants, 'expoConfig', null);
      await registerForPushNotifications('jwt');
      expect(mockNotifications.getPermissionsAsync).not.toHaveBeenCalled();
    });

    it('never throws, e.g. when offline', async () => {
      jest.mocked(apiFetch).mockRejectedValueOnce(new Error('offline'));
      await expect(registerForPushNotifications('jwt')).resolves.toBeUndefined();
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    });
  });

  describe('unregisterPushNotifications', () => {
    it('removes this phone from the server and forgets the token', async () => {
      jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('ExponentPushToken[a/b]');

      await unregisterPushNotifications('jwt');

      expect(apiFetch).toHaveBeenCalledWith('/api/devices/ExponentPushToken%5Ba%2Fb%5D', { method: 'DELETE', token: 'jwt' });
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('sitecheck.pushToken');
    });

    it('does nothing without a stored token, and keeps it when offline', async () => {
      jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(null);
      await unregisterPushNotifications('jwt');
      expect(apiFetch).not.toHaveBeenCalled();

      jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('ExponentPushToken[a]');
      jest.mocked(apiFetch).mockRejectedValueOnce(new Error('offline'));
      await unregisterPushNotifications('jwt');
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    });
  });
});
