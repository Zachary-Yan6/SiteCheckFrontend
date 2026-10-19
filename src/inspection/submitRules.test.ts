import { describe, expect, it } from '@jest/globals';

import { checkForSubmit, itemProblems, type AnswerForRules } from './submitRules';

const answer = (overrides: Partial<AnswerForRules>): AnswerForRules => ({
  templateItemId: 1,
  result: null,
  note: null,
  photoCount: 0,
  ...overrides,
});

describe('itemProblems', () => {
  it('requires an answer', () => {
    expect(itemProblems(answer({}))).toEqual(['Choose Pass, Fail or N/A']);
  });

  it('accepts PASS and N/A with no note or photo', () => {
    expect(itemProblems(answer({ result: 'PASS' }))).toEqual([]);
    expect(itemProblems(answer({ result: 'NA' }))).toEqual([]);
  });

  it('requires a note and a photo for FAIL', () => {
    expect(itemProblems(answer({ result: 'FAIL' }))).toEqual([
      'Describe the problem in a note',
      'Take at least one photo',
    ]);
  });

  it('does not count a whitespace-only note', () => {
    expect(itemProblems(answer({ result: 'FAIL', note: '   ', photoCount: 1 }))).toEqual([
      'Describe the problem in a note',
    ]);
  });

  it('accepts FAIL with a note and a photo', () => {
    expect(itemProblems(answer({ result: 'FAIL', note: 'Toe board missing', photoCount: 2 }))).toEqual([]);
  });
});

describe('checkForSubmit', () => {
  it('lists incomplete items and blocks submit', () => {
    const check = checkForSubmit([
      answer({ templateItemId: 1, result: 'PASS' }),
      answer({ templateItemId: 2, result: 'FAIL', note: 'Loose tie' }),
      answer({ templateItemId: 3 }),
    ]);

    expect(check.answered).toBe(2);
    expect(check.total).toBe(3);
    expect(check.incomplete.map((i) => i.templateItemId)).toEqual([2, 3]);
    expect(check.canSubmit).toBe(false);
  });

  it('allows submit when every item is complete', () => {
    const check = checkForSubmit([
      answer({ templateItemId: 1, result: 'PASS' }),
      answer({ templateItemId: 2, result: 'FAIL', note: 'Loose tie', photoCount: 1 }),
      answer({ templateItemId: 3, result: 'NA' }),
    ]);

    expect(check.incomplete).toEqual([]);
    expect(check.canSubmit).toBe(true);
  });

  it('never allows submitting an empty checklist', () => {
    expect(checkForSubmit([]).canSubmit).toBe(false);
  });
});
