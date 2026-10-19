import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { DueBadge, dueLabel } from './DueBadge';

describe('dueLabel', () => {
  it('says how overdue or how far off a check is', () => {
    expect(dueLabel('overdue', null)).toBe('Never inspected');
    expect(dueLabel('overdue', -1)).toBe('Overdue 1 day');
    expect(dueLabel('overdue', -3)).toBe('Overdue 3 days');
    expect(dueLabel('dueToday', 0)).toBe('Due today');
    expect(dueLabel('ok', 1)).toBe('Due in 1 day');
    expect(dueLabel('ok', 5)).toBe('Due in 5 days');
    expect(dueLabel('ok', Infinity)).toBe('No checks'); // a site without any checks
  });
});

describe('DueBadge', () => {
  it('shows the label in the colour of its state', async () => {
    await render(<DueBadge state="overdue" daysUntilDue={-2} />);
    expect(screen.getByText('Overdue 2 days')).toHaveStyle({ color: '#b71c1c' });
  });
});
