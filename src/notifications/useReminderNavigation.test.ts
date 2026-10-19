import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { NotificationResponse } from 'expo-notifications';
import { router } from 'expo-router';

import { useReminderNavigation } from './useReminderNavigation';

type Listener = (response: NotificationResponse | null) => void;

const mockRemove = jest.fn();
let mockListener: Listener | null = null;
const mockNotifications = {
  getLastNotificationResponseAsync: jest.fn(async (): Promise<NotificationResponse | null> => null),
  clearLastNotificationResponseAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn((listener: Listener) => {
    mockListener = listener;
    return { remove: mockRemove };
  }),
};
let mockAvailable = true;

jest.mock('./notificationsModule', () => ({
  get Notifications() {
    return mockAvailable ? mockNotifications : null;
  },
}));
jest.mock('expo-router', () => require('@/test/mockExpoRouter'));

const tap = (url: unknown) => ({ notification: { request: { content: { data: { url } } } } }) as unknown as NotificationResponse;

/** FR-29: a tapped reminder opens its site. */
describe('useReminderNavigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAvailable = true;
    mockListener = null;
  });

  it('opens the site of the reminder that launched the app', async () => {
    mockNotifications.getLastNotificationResponseAsync.mockResolvedValueOnce(tap('/site/3'));

    await renderHook(() => useReminderNavigation(true));

    expect(router.push).toHaveBeenCalledWith('/site/3');
    expect(mockNotifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
  });

  it('opens the site of a reminder tapped while the app runs, and ignores other notifications', async () => {
    await renderHook(() => useReminderNavigation(true));

    await act(() => mockListener!(tap('https://example.com')));
    expect(router.push).not.toHaveBeenCalled();

    await act(() => mockListener!(tap('/site/5')));
    expect(router.push).toHaveBeenCalledWith('/site/5');
  });

  it('stops listening when switched off or unmounted', async () => {
    const { rerender, unmount } = await renderHook(({ enabled }: { enabled: boolean }) => useReminderNavigation(enabled), {
      initialProps: { enabled: true },
    });
    await rerender({ enabled: false });
    expect(mockRemove).toHaveBeenCalledTimes(1);

    await unmount();
    expect(mockNotifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
  });

  it('drops a launch tap that arrives after unmounting', async () => {
    let answer: (response: NotificationResponse) => void = () => {};
    mockNotifications.getLastNotificationResponseAsync.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const { unmount } = await renderHook(() => useReminderNavigation(true));

    await unmount();
    await act(async () => answer(tap('/site/3')));

    expect(router.push).not.toHaveBeenCalled();
  });

  it('does nothing while logged out or without push support', async () => {
    await renderHook(() => useReminderNavigation(false));
    mockAvailable = false;
    await renderHook(() => useReminderNavigation(true));
    expect(mockNotifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
  });
});
