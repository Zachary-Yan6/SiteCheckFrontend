import { jest } from '@jest/globals';
import { act, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import type { BootstrapResponse, User } from '@/api/types';
import type { Session } from '@/auth/sessionStorage';

export const AOIFE: User = { id: 2, email: 'aoife.murphy@sitecheck.demo', fullName: 'Aoife Murphy', role: 'INSPECTOR' };
export const SIOBHAN: User = { id: 4, email: 'siobhan.kelly@sitecheck.demo', fullName: 'Siobhan Kelly', role: 'MANAGER' };

export function sessionFor(user: User): Session {
  return { token: `token-${user.id}`, expiresAt: '2026-10-14T09:00:00Z', user };
}

/** Two sites, two checks: like the backend's demo seed, but small. */
export function bootstrap(overrides: Partial<BootstrapResponse> = {}): BootstrapResponse {
  return {
    serverTime: '2026-10-13T08:00:00Z',
    templates: [
      {
        id: 1,
        name: 'Scaffold Inspection',
        description: 'Weekly scaffold check',
        frequencyDays: 7,
        items: [
          { id: 10, position: 1, title: 'Base plates and sole boards', guidance: 'Check for sinking' },
          { id: 11, position: 2, title: 'Guard rails in place', guidance: null },
        ],
      },
      {
        id: 2,
        name: 'Lifting Equipment Check',
        description: null,
        frequencyDays: 30,
        items: [{ id: 20, position: 1, title: 'Hook latch works', guidance: null }],
      },
    ],
    sites: [
      {
        id: 3,
        name: 'Cork Docklands Office Block',
        address: 'Kennedy Quay, Cork',
        latitude: 51.9,
        longitude: -8.45,
        schedules: [
          { templateId: 1, lastInspectedAt: '2026-10-01T09:00:00Z' },
          { templateId: 2, lastInspectedAt: null },
        ],
      },
      {
        id: 5,
        name: 'Galway Student Residence',
        address: 'Headford Road, Galway',
        latitude: null,
        longitude: null,
        schedules: [],
      },
    ],
    ...overrides,
  };
}

/**
 * Pull-to-refresh on the screen's list. The test renderer keeps the RefreshControl element as the
 * scroll view's `refreshControl` prop, so we call its onRefresh and wait for it to finish.
 */
export async function pullToRefresh(): Promise<void> {
  const [list] = screen.container.queryAll((node) => node.props.refreshControl !== undefined);
  if (!list) throw new Error('No RefreshControl on the screen');
  await act(async () => {
    await list.props.refreshControl.props.onRefresh();
  });
}

/** Spies on Alert.alert; `pressAlertButton` then "taps" one of the buttons of the last alert. */
export function spyOnAlert() {
  return jest.spyOn(Alert, 'alert').mockImplementation(() => {});
}

export function pressAlertButton(spy: ReturnType<typeof spyOnAlert>, text: string): void {
  const buttons = spy.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const button = buttons?.find((b) => b.text === text);
  if (!button?.onPress) throw new Error(`The last alert has no "${text}" button`);
  button.onPress();
}
