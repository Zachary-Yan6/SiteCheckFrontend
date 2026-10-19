import { describe, expect, it } from '@jest/globals';

import { scheduleStatus, siteStatus, sortByUrgency, type ScheduleInput, type SiteInput } from './dueStatus';

// jest.globalSetup.js pins the time zone to Europe/Dublin, so these local times are Irish times.
const at = (localIso: string) => new Date(localIso);

const scaffold = (lastInspectedAt: string | null): ScheduleInput => ({
  templateId: 1,
  templateName: 'Scaffold Inspection',
  frequencyDays: 7,
  lastInspectedAt,
});

describe('scheduleStatus', () => {
  it('treats a never-inspected check as overdue', () => {
    const status = scheduleStatus(scaffold(null), at('2026-10-13T09:00:00'));
    expect(status.state).toBe('overdue');
    expect(status.daysUntilDue).toBeNull();
  });

  it('is due today exactly one cycle after the last inspection', () => {
    const status = scheduleStatus(scaffold('2026-10-06T10:00:00+01:00'), at('2026-10-13T16:00:00'));
    expect(status).toMatchObject({ state: 'dueToday', daysUntilDue: 0 });
  });

  it('counts days overdue as a negative number', () => {
    const status = scheduleStatus(scaffold('2026-10-03T10:00:00+01:00'), at('2026-10-13T09:00:00'));
    expect(status).toMatchObject({ state: 'overdue', daysUntilDue: -3 });
  });

  it('is ok with days remaining before the due date', () => {
    const status = scheduleStatus(scaffold('2026-10-10T10:00:00+01:00'), at('2026-10-13T09:00:00'));
    expect(status).toMatchObject({ state: 'ok', daysUntilDue: 4 });
  });

  it('works in calendar days, not 24-hour blocks', () => {
    // Inspected late on the 6th: due on the 13th, even early in the morning.
    const status = scheduleStatus(scaffold('2026-10-06T23:30:00+01:00'), at('2026-10-13T07:00:00'));
    expect(status).toMatchObject({ state: 'dueToday', daysUntilDue: 0 });
  });

  it('uses the local day of a timestamp stored in UTC', () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in Ireland (summer time), so the cycle starts on 1 July.
    const status = scheduleStatus(scaffold('2026-06-30T23:30:00Z'), at('2026-07-08T09:00:00'));
    expect(status).toMatchObject({ state: 'dueToday', daysUntilDue: 0 });
  });

  it('is not shifted by the switch to summer time', () => {
    // Clocks go forward on 29 March 2026; the 7-day cycle still lands on 1 April.
    const status = scheduleStatus(scaffold('2026-03-25T10:00:00Z'), at('2026-04-01T00:30:00'));
    expect(status).toMatchObject({ state: 'dueToday', daysUntilDue: 0 });
  });

  it('is not shifted by the switch back to winter time', () => {
    // Clocks go back on 25 October 2026.
    const status = scheduleStatus(scaffold('2026-10-22T10:00:00+01:00'), at('2026-10-29T23:30:00'));
    expect(status).toMatchObject({ state: 'dueToday', daysUntilDue: 0 });
  });
});

describe('siteStatus', () => {
  const now = at('2026-10-13T09:00:00');

  it('takes the state of its most urgent check and lists checks most urgent first', () => {
    const site: SiteInput = {
      id: 1,
      name: 'Cork Docklands Office Block',
      address: 'Kennedy Quay, Cork',
      schedules: [
        { templateId: 1, templateName: 'Scaffold Inspection', frequencyDays: 7, lastInspectedAt: '2026-10-12T10:00:00+01:00' },
        { templateId: 4, templateName: 'Lifting Equipment Check', frequencyDays: 30, lastInspectedAt: '2026-09-01T10:00:00+01:00' },
      ],
    };

    const status = siteStatus(site, now);

    expect(status.state).toBe('overdue');
    expect(status.daysUntilDue).toBe(-12);
    expect(status.schedules.map((s) => s.templateName)).toEqual(['Lifting Equipment Check', 'Scaffold Inspection']);
  });

  it('is ok when the site has no checks at all', () => {
    const status = siteStatus({ id: 2, name: 'Empty', address: '', schedules: [] }, now);
    expect(status.state).toBe('ok');
  });
});

describe('sortByUrgency', () => {
  const now = at('2026-10-13T09:00:00');
  const site = (name: string, lastInspectedAt: string | null): SiteInput => ({
    id: name.length,
    name,
    address: '',
    schedules: [scaffold(lastInspectedAt)],
  });

  it('orders never inspected, then most overdue, then due today, then soonest due, then by name', () => {
    const sites = [
      site('OK in 5 days', '2026-10-11T10:00:00+01:00'),
      site('Due today', '2026-10-06T10:00:00+01:00'),
      site('B overdue 2 days', '2026-10-04T10:00:00+01:00'),
      site('Never inspected', null),
      site('Overdue 9 days', '2026-09-27T10:00:00+01:00'),
      site('A overdue 2 days', '2026-10-04T10:00:00+01:00'),
      site('OK in 1 day', '2026-10-07T10:00:00+01:00'),
    ].map((s) => siteStatus(s, now));

    expect(sortByUrgency(sites).map((s) => s.name)).toEqual([
      'Never inspected',
      'Overdue 9 days',
      'A overdue 2 days',
      'B overdue 2 days',
      'Due today',
      'OK in 1 day',
      'OK in 5 days',
    ]);
  });
});
