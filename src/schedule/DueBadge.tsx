import { StyleSheet, Text } from 'react-native';

import type { DueState } from '@/schedule/dueStatus';

const COLORS: Record<DueState, { background: string; text: string }> = {
  overdue: { background: '#fdecea', text: '#b71c1c' },
  dueToday: { background: '#fff4e5', text: '#a64b00' },
  ok: { background: '#e8f5e9', text: '#1b5e20' },
};

/** Short label like "Overdue 3 days", "Due today" or "Due in 5 days". */
export function dueLabel(state: DueState, daysUntilDue: number | null): string {
  if (daysUntilDue === null) return 'Never inspected';
  if (state === 'overdue') return `Overdue ${plural(-daysUntilDue, 'day')}`;
  if (state === 'dueToday') return 'Due today';
  if (!Number.isFinite(daysUntilDue)) return 'No checks';
  return `Due in ${plural(daysUntilDue, 'day')}`;
}

export function DueBadge({ state, daysUntilDue }: { state: DueState; daysUntilDue: number | null }) {
  const colors = COLORS[state];
  return (
    <Text style={[styles.badge, { backgroundColor: colors.background, color: colors.text }]}>
      {dueLabel(state, daysUntilDue)}
    </Text>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 13,
    fontWeight: '600',
    overflow: 'hidden',
  },
});
