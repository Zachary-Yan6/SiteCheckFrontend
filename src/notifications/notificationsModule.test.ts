import { describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-notifications', () => ({ isFake: true }));

/** Which builds get expo-notifications at all (Expo Go on Android can't even import it). */
describe('Notifications', () => {
  function load(os: 'ios' | 'android', expoGo: boolean) {
    let module: typeof import('./notificationsModule') | undefined;
    jest.isolateModules(() => {
      jest.doMock('expo', () => ({ isRunningInExpoGo: () => expoGo }));
      jest.doMock('react-native', () => ({ Platform: { OS: os } }));
      module = require('./notificationsModule');
    });
    return module!.Notifications;
  }

  it('is unavailable in Expo Go on Android', () => {
    expect(load('android', true)).toBeNull();
  });

  it('loads in Android development and release builds', () => {
    expect(load('android', false)).toEqual({ isFake: true });
  });

  it('loads on iOS, Expo Go included', () => {
    expect(load('ios', true)).toEqual({ isFake: true });
  });
});
