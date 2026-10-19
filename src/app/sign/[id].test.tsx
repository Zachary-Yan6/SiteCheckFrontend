import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { getInspection, submitInspection, type Inspection } from '@/db/inspectionRepository';
import { refreshCounts, requestSync } from '@/sync/syncManager';
import { spyOnAlert } from '@/test/helpers';
import { setSearchParams } from '@/test/mockExpoRouter';

import SignScreen from './[id]';

jest.mock('expo-router', () => require('@/test/mockExpoRouter'));
jest.mock('@/db/inspectionRepository', () => ({ getInspection: jest.fn(), submitInspection: jest.fn() }));
jest.mock('@/sync/syncManager', () => ({ refreshCounts: jest.fn(), requestSync: jest.fn() }));

/** The real canvas is a WebView; this stand-in has one button for "signed" and one for "empty". */
jest.mock('react-native-signature-canvas', () => {
  const { forwardRef } = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: forwardRef(function FakeSignature(
      props: { onOK: (dataUrl: string) => void; onEmpty: () => void; confirmText: string },
      _ref: unknown,
    ) {
      return (
        <>
          <Pressable onPress={() => props.onOK('data:image/png;base64,iVBORw0KGgo=')}>
            <Text>{props.confirmText}</Text>
          </Pressable>
          <Pressable onPress={props.onEmpty}>
            <Text>Submit without signing</Text>
          </Pressable>
        </>
      );
    }),
  };
});

const inspection: Inspection = {
  id: 'insp-1', siteId: 3, siteName: 'Cork Docklands Office Block', templateId: 1, templateName: 'Scaffold Inspection',
  status: 'DRAFT', startedAt: '2026-10-13T09:00:00Z', submittedAt: null,
};

/** FR-15: sign, then submit to the local queue - works with no signal. */
describe('SignScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setSearchParams({ id: 'insp-1' });
    jest.mocked(getInspection).mockResolvedValue(inspection);
    jest.mocked(submitInspection).mockResolvedValue();
  });

  it('submits with the signature, starts a sync and goes back to the site', async () => {
    await render(<SignScreen />);
    expect(await screen.findByText('Scaffold Inspection at Cork Docklands Office Block')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Submit'));

    expect(submitInspection).toHaveBeenCalledWith('insp-1', 'iVBORw0KGgo='); // data-URL prefix removed
    expect(refreshCounts).toHaveBeenCalled();
    expect(requestSync).toHaveBeenCalled();
    expect(router.dismissTo).toHaveBeenCalledWith({ pathname: '/site/[id]', params: { id: '3' } });
  });

  it('submits only once, even if the button is tapped again while leaving', async () => {
    await render(<SignScreen />);

    await fireEvent.press(await screen.findByText('Submit'));
    await fireEvent.press(screen.getByText('Submitting...'));

    expect(submitInspection).toHaveBeenCalledTimes(1);
  });

  it('stays on the screen and explains a refused submit', async () => {
    const alert = spyOnAlert();
    jest.mocked(submitInspection).mockRejectedValueOnce(new Error('Some items are still incomplete.'));
    await render(<SignScreen />);

    await fireEvent.press(await screen.findByText('Submit'));
    expect(alert).toHaveBeenCalledWith('Not submitted', 'Some items are still incomplete.');
    expect(router.dismissTo).not.toHaveBeenCalled();

    jest.mocked(submitInspection).mockRejectedValueOnce('locked');
    await fireEvent.press(screen.getByText('Submit')); // the button works again
    expect(alert).toHaveBeenLastCalledWith('Not submitted', 'locked');
  });

  it('asks for a signature first', async () => {
    const alert = spyOnAlert();
    await render(<SignScreen />);
    await fireEvent.press(await screen.findByText('Submit without signing'));
    expect(alert).toHaveBeenCalledWith('Please sign in the box first');
    expect(submitInspection).not.toHaveBeenCalled();
  });

  it('shows nothing until loaded, and ignores a load after closing', async () => {
    let answer: (found: Inspection) => void = () => {};
    jest.mocked(getInspection).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render(<SignScreen />);
    expect(screen.root).toBeUndefined();

    await screen.unmount();
    await act(async () => answer(inspection));
  });
});
