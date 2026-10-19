import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import {
  getInspection,
  listAnswers,
  listPhotos,
  saveNote,
  saveResult,
  type Answer,
  type Inspection,
} from '@/db/inspectionRepository';
import { removeEvidencePhoto, takeEvidencePhoto } from '@/inspection/photoCapture';
import { pressAlertButton, spyOnAlert } from '@/test/helpers';
import { setSearchParams } from '@/test/mockExpoRouter';

import InspectionScreen from './[id]';

jest.mock('expo-router', () => require('@/test/mockExpoRouter'));
jest.mock('@/db/inspectionRepository', () => ({
  getInspection: jest.fn(),
  listAnswers: jest.fn(),
  listPhotos: jest.fn(),
  saveNote: jest.fn(),
  saveResult: jest.fn(),
}));
jest.mock('@/inspection/photoCapture', () => ({ takeEvidencePhoto: jest.fn(), removeEvidencePhoto: jest.fn() }));

const draft: Inspection = {
  id: 'insp-1', siteId: 3, siteName: 'Cork Docklands Office Block', templateId: 1, templateName: 'Scaffold Inspection',
  status: 'DRAFT', startedAt: '2026-10-13T09:00:00Z', submittedAt: null,
};
const answer = (overrides: Partial<Answer>): Answer => ({
  templateItemId: 10, position: 1, title: 'Base plates and sole boards', guidance: 'Check for sinking',
  result: null, note: null, photoCount: 0, ...overrides,
});

const radio = (label: 'Pass' | 'Fail' | 'N/A', item = 0) => screen.getAllByRole('radio', { name: label })[item];

/** The checklist (FR-10 to FR-14): every tap is saved straight to SQLite. */
describe('InspectionScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setSearchParams({ id: 'insp-1' });
    jest.mocked(getInspection).mockResolvedValue(draft);
    jest.mocked(listAnswers).mockResolvedValue([
      answer({}),
      answer({ templateItemId: 11, position: 2, title: 'Guard rails in place', guidance: null }),
    ]);
    jest.mocked(listPhotos).mockResolvedValue([]);
    jest.mocked(saveResult).mockResolvedValue();
    jest.mocked(saveNote).mockResolvedValue();
  });

  it('shows the items and how far the inspector has got', async () => {
    await render(<InspectionScreen />);

    expect(await screen.findByText('Cork Docklands Office Block')).toBeOnTheScreen();
    expect(screen.getByText('1. Base plates and sole boards')).toBeOnTheScreen();
    expect(screen.getByText('Check for sinking')).toBeOnTheScreen();
    expect(screen.getByText('0 of 2 answered · 2 need attention')).toBeOnTheScreen();
    expect(screen.getByText('Sign & submit')).toBeDisabled();
  });

  it('saves each answer straight away and enables submit once all are answered', async () => {
    await render(<InspectionScreen />);
    await screen.findByText('0 of 2 answered · 2 need attention');

    await fireEvent.press(radio('Pass', 0));
    await fireEvent.press(radio('N/A', 1));

    expect(saveResult).toHaveBeenCalledWith('insp-1', 10, 'PASS');
    expect(saveResult).toHaveBeenCalledWith('insp-1', 11, 'NA');
    expect(radio('Pass', 0)).toBeSelected();
    expect(screen.getByText('2 of 2 answered')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Sign & submit'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/sign/[id]', params: { id: 'insp-1' } });
  });

  it('a FAIL asks for a note and a photo before it can be submitted', async () => {
    await render(<InspectionScreen />);
    await screen.findByText('0 of 2 answered · 2 need attention');

    await fireEvent.press(radio('Fail', 0));
    await fireEvent.changeText(screen.getByPlaceholderText('What is wrong? (required)'), 'Sole board missing');

    expect(saveNote).toHaveBeenCalledWith('insp-1', 10, 'Sole board missing');
    expect(screen.getByLabelText('Take photo')).toBeOnTheScreen();
    expect(screen.getByText(/need attention/)).toBeOnTheScreen();
  });

  it('shows when an answer could not be saved', async () => {
    jest.mocked(saveResult).mockRejectedValueOnce(new Error('database is locked')).mockRejectedValueOnce('disk full');
    await render(<InspectionScreen />);
    await screen.findByText('0 of 2 answered · 2 need attention');

    await fireEvent.press(radio('Pass', 0));
    expect(await screen.findByText('Not saved: database is locked')).toBeOnTheScreen();

    await fireEvent.press(radio('Pass', 1));
    expect(await screen.findByText('Not saved: disk full')).toBeOnTheScreen();

    await fireEvent.press(radio('N/A', 1));
    expect(screen.queryByText(/Not saved/)).not.toBeOnTheScreen();
  });

  it('takes an evidence photo and shows it', async () => {
    jest.mocked(listAnswers).mockResolvedValue([answer({ result: 'FAIL', note: 'Sole board missing' })]);
    jest.mocked(takeEvidencePhoto).mockResolvedValue(true);
    await render(<InspectionScreen />);
    jest.mocked(listPhotos).mockResolvedValue([{ id: 'p1', templateItemId: 10, fileUri: 'file:///p1.jpg' }]);

    await fireEvent.press(await screen.findByLabelText('Take photo'));

    expect(takeEvidencePhoto).toHaveBeenCalledWith('insp-1', 10);
    expect(await screen.findByLabelText('Evidence photo. Long-press to delete.')).toBeOnTheScreen();
  });

  it('does nothing when the camera is closed without a photo, and explains a failed one', async () => {
    const alert = spyOnAlert();
    jest.mocked(listAnswers).mockResolvedValue([answer({ result: 'FAIL' })]);
    await render(<InspectionScreen />);
    const reloads = jest.mocked(listPhotos).mock.calls.length;

    jest.mocked(takeEvidencePhoto).mockResolvedValueOnce(false);
    await fireEvent.press(await screen.findByLabelText('Take photo'));
    expect(listPhotos).toHaveBeenCalledTimes(reloads);

    jest.mocked(takeEvidencePhoto).mockRejectedValueOnce(new Error('SiteCheck needs camera access'));
    await fireEvent.press(screen.getByLabelText('Take photo'));
    expect(alert).toHaveBeenCalledWith('Photo not saved', 'SiteCheck needs camera access');

    jest.mocked(takeEvidencePhoto).mockRejectedValueOnce('no space');
    await fireEvent.press(screen.getByLabelText('Take photo'));
    expect(alert).toHaveBeenLastCalledWith('Photo not saved', 'no space');
  });

  it('deletes a photo after a long press and a confirmation', async () => {
    const alert = spyOnAlert();
    jest.mocked(listAnswers).mockResolvedValue([answer({ result: 'FAIL', photoCount: 1 })]);
    jest.mocked(listPhotos).mockResolvedValue([{ id: 'p1', templateItemId: 10, fileUri: 'file:///p1.jpg' }]);
    jest.mocked(removeEvidencePhoto).mockResolvedValue();
    await render(<InspectionScreen />);

    await fireEvent(await screen.findByLabelText('Evidence photo. Long-press to delete.'), 'longPress');
    expect(alert).toHaveBeenCalledWith('Delete this photo?', undefined, expect.any(Array));

    jest.mocked(listPhotos).mockResolvedValue([]);
    await act(async () => pressAlertButton(alert, 'Delete'));

    expect(removeEvidencePhoto).toHaveBeenCalledWith('p1');
    expect(screen.queryByLabelText('Evidence photo. Long-press to delete.')).not.toBeOnTheScreen();
  });

  it('is read-only once submitted', async () => {
    jest.mocked(getInspection).mockResolvedValue({ ...draft, status: 'PENDING', submittedAt: '2026-10-13T09:30:00Z' });
    jest.mocked(listAnswers).mockResolvedValue([answer({ result: 'FAIL', note: 'Sole board missing' })]);
    jest.mocked(listPhotos).mockResolvedValue([{ id: 'p1', templateItemId: 10, fileUri: 'file:///p1.jpg' }]);
    await render(<InspectionScreen />);

    expect(await screen.findByText('Submitted - read only')).toBeOnTheScreen();
    expect(radio('Pass')).toBeDisabled();
    expect(screen.getByDisplayValue('Sole board missing')).not.toBeEnabled();
    expect(screen.queryByLabelText('Take photo')).not.toBeOnTheScreen();
    expect(screen.queryByText('Sign & submit')).not.toBeOnTheScreen();
  });

  it('shows a note written before the answer was chosen', async () => {
    jest.mocked(listAnswers).mockResolvedValue([answer({ note: 'Check again after the rain' })]);
    await render(<InspectionScreen />);
    expect(await screen.findByPlaceholderText('Note (optional)')).toHaveDisplayValue('Check again after the rain');
  });

  it('shows nothing until the inspection is loaded, and ignores a load after closing', async () => {
    let answerLoad: (inspection: Inspection) => void = () => {};
    jest.mocked(getInspection).mockReturnValueOnce(new Promise((resolve) => (answerLoad = resolve)));
    await render(<InspectionScreen />);
    expect(screen.root).toBeUndefined();

    await screen.unmount();
    await act(async () => answerLoad(draft));
  });
});
