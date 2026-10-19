/**
 * Due-date rules for the home screen (FR-08). Pure functions - no database, no clock of their own -
 * so they are easy to unit-test and work the same offline.
 *
 * Due dates are calendar days in the phone's time zone, not "N x 24 hours": a scaffold checked at
 * 23:30 on the 6th with a 7-day cycle is due on the 13th, whatever time it is on the 13th. Working
 * in calendar days also keeps the summer-time switch from shifting anything by an hour.
 */

export type DueState = 'overdue' | 'dueToday' | 'ok';

export interface ScheduleInput {
  templateId: number;
  templateName: string;
  frequencyDays: number;
  /** ISO-8601; null = never inspected. */
  lastInspectedAt: string | null;
}

export interface ScheduleStatus extends ScheduleInput {
  state: DueState;
  /**
   * Days until due: 0 = today, negative = days overdue.
   * null = never inspected, which counts as the most overdue of all.
   */
  daysUntilDue: number | null;
}

export interface SiteInput {
  id: number;
  name: string;
  address: string;
  schedules: ScheduleInput[];
}

export interface SiteStatus extends Omit<SiteInput, 'schedules'> {
  /** The site's checks, most urgent first. */
  schedules: ScheduleStatus[];
  /** The most urgent check decides the site's state. A site with no checks is 'ok'. */
  state: DueState;
  daysUntilDue: number | null;
}

export function scheduleStatus(schedule: ScheduleInput, now: Date): ScheduleStatus {
  if (schedule.lastInspectedAt === null) {
    return { ...schedule, state: 'overdue', daysUntilDue: null };
  }
  const lastDay = startOfDay(new Date(schedule.lastInspectedAt));
  const dueDay = addDays(lastDay, schedule.frequencyDays);
  const daysUntilDue = daysBetween(startOfDay(now), dueDay);
  return { ...schedule, state: stateFor(daysUntilDue), daysUntilDue };
}

export function siteStatus(site: SiteInput, now: Date): SiteStatus {
  const schedules = site.schedules
    .map((s) => scheduleStatus(s, now))
    .sort((a, b) => urgency(a.daysUntilDue) - urgency(b.daysUntilDue) || a.templateName.localeCompare(b.templateName));

  if (schedules.length === 0) {
    return { ...site, schedules, state: 'ok', daysUntilDue: Number.POSITIVE_INFINITY };
  }
  const mostUrgent = schedules[0];
  return { ...site, schedules, state: mostUrgent.state, daysUntilDue: mostUrgent.daysUntilDue };
}

/** Home screen order: overdue (worst first) -> due today -> ok (soonest first), then by name. */
export function sortByUrgency(sites: SiteStatus[]): SiteStatus[] {
  return [...sites].sort(
    (a, b) => urgency(a.daysUntilDue) - urgency(b.daysUntilDue) || a.name.localeCompare(b.name),
  );
}

/** Lower = more urgent. Never inspected beats any number of days overdue. */
function urgency(daysUntilDue: number | null): number {
  return daysUntilDue ?? Number.NEGATIVE_INFINITY;
}

function stateFor(daysUntilDue: number): DueState {
  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue === 0) return 'dueToday';
  return 'ok';
}

/** Local midnight of the given moment. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Same local time-of-day, N calendar days later (Date handles month/year roll-over). */
function addDays(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
}

/**
 * Whole calendar days from one local midnight to another. A day with a summer-time switch is
 * 23 or 25 hours long, so round instead of truncating.
 */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
