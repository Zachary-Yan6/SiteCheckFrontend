import { describe, expect, it } from '@jest/globals';
import type { NotificationResponse } from 'expo-notifications';

import { routeFromNotification } from './routeFromNotification';

/** A tap on a notification whose payload is `data`. */
const tap = (data: Record<string, unknown>) =>
  ({ notification: { request: { content: { data } } } }) as unknown as NotificationResponse;

describe('routeFromNotification', () => {
  it('opens the site from a reminder (FR-29)', () => {
    expect(routeFromNotification(tap({ url: '/site/3', siteId: 3 }))).toBe('/site/3');
  });

  it('ignores notifications without an in-app route', () => {
    expect(routeFromNotification(null)).toBeNull();
    expect(routeFromNotification(tap({}))).toBeNull();
    expect(routeFromNotification(tap({ url: 42 }))).toBeNull();
    expect(routeFromNotification(tap({ url: 'https://example.com' }))).toBeNull();
  });
});
