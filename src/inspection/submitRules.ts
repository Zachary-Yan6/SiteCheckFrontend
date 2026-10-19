/**
 * What must be true before an inspection can be signed and submitted (FR-11, FR-12).
 * Pure functions, so the form can show problems live and the rules are unit-tested.
 * The server checks the same rules again - the app just tells the user first.
 */

export type ItemResult = 'PASS' | 'FAIL' | 'NA';

export interface AnswerForRules {
  templateItemId: number;
  result: ItemResult | null;
  note: string | null;
  photoCount: number;
}

/** What's still missing for one checklist item; empty when the item is complete. */
export function itemProblems(answer: AnswerForRules): string[] {
  if (answer.result === null) {
    return ['Choose Pass, Fail or N/A'];
  }
  const problems: string[] = [];
  if (answer.result === 'FAIL') {
    // Only failures need evidence: matches how inspectors work, and keeps uploads small on weak signal.
    if (!answer.note?.trim()) problems.push('Describe the problem in a note');
    if (answer.photoCount === 0) problems.push('Take at least one photo');
  }
  return problems;
}

export interface SubmitCheck {
  answered: number;
  total: number;
  /** Items with something missing, in the order given. */
  incomplete: { templateItemId: number; problems: string[] }[];
  canSubmit: boolean;
}

export function checkForSubmit(answers: AnswerForRules[]): SubmitCheck {
  const incomplete = answers
    .map((a) => ({ templateItemId: a.templateItemId, problems: itemProblems(a) }))
    .filter((item) => item.problems.length > 0);
  return {
    answered: answers.filter((a) => a.result !== null).length,
    total: answers.length,
    incomplete,
    canSubmit: answers.length > 0 && incomplete.length === 0,
  };
}
