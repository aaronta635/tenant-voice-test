import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./api', () => http);

import {
  formatVisitLength,
  providerRepairs,
  repairCategoryLabel,
  sydneyWallClock,
  visitFormValues,
  visitHasStarted,
  visitProblem,
} from './provider-repairs';

beforeEach(() => http.apiFetch.mockReset().mockResolvedValue({}));

describe('the provider repairs API', () => {
  it('lists, books and completes the caller\'s own repairs', async () => {
    await providerRepairs.list();
    await providerRepairs.schedule('r1', { date: '2030-01-20', time: '09:30', duration_minutes: 90, note: null });
    await providerRepairs.complete('r1', 'Replaced the tap washer.');

    expect(http.apiFetch.mock.calls).toEqual([
      ['/me/repairs'],
      ['/me/repairs/r1/schedule', { method: 'POST', body: { date: '2030-01-20', time: '09:30', duration_minutes: 90, note: null } }],
      ['/me/repairs/r1/complete', { method: 'POST', body: { note: 'Replaced the tap washer.' } }],
    ]);
  });
});

describe('repair labels', () => {
  it('names the shared category codes, and anything else as General', () => {
    expect(repairCategoryLabel('HVAC')).toBe('Heating & Cooling');
    expect(repairCategoryLabel('locks_security')).toBe('Locks / Security');
    expect(repairCategoryLabel('ROOF_LEAK')).toBe('General');
    expect(repairCategoryLabel('')).toBe('General');
  });

  it('says how long a visit takes', () => {
    expect([30, 60, 90, 480].map(formatVisitLength)).toEqual(['30 min', '1 h', '1 h 30 min', '8 h']);
    expect(formatVisitLength(null)).toBe('');
  });
});

describe('visit times in Sydney', () => {
  it('reads a moment as the Sydney wall clock, in daylight time and out of it', () => {
    expect(sydneyWallClock(new Date('2030-01-19T22:30:00Z'))).toBe('2030-01-20T09:30');
    expect(sydneyWallClock(new Date('2030-06-30T23:00:00Z'))).toBe('2030-07-01T09:00');
    expect(sydneyWallClock(new Date('2030-01-19T13:00:00Z'))).toBe('2030-01-20T00:00');
  });

  it('opens a booked visit at its own Sydney day, time, length and note', () => {
    const repair = { appointment_at: '2030-01-19T22:30:00Z', estimated_duration_minutes: 90, appointment_note: 'Call first' };

    expect(visitFormValues(repair)).toEqual({ date: '2030-01-20', time: '09:30', duration: 90, note: 'Call first' });
  });

  it('offers tomorrow at 9 am, for an hour, for a visit not booked yet', () => {
    const repair = { appointment_at: null, estimated_duration_minutes: null, appointment_note: null };

    // 11 pm on 14 January in Sydney: tomorrow is the 15th there, though it is still the 14th in UTC.
    expect(visitFormValues(repair, new Date('2030-01-14T12:00:00Z'))).toEqual({ date: '2030-01-15', time: '09:00', duration: 60, note: '' });
  });

  it('refuses a visit time that has passed in Sydney, and one not chosen', () => {
    const now = new Date('2030-01-15T01:00:00Z'); // noon on the 15th in Sydney

    expect(visitProblem('2030-01-15', '11:59', now)).toMatch(/has not passed/);
    expect(visitProblem('2030-01-15', '12:00', now)).toMatch(/has not passed/);
    expect(visitProblem('2030-01-15', '12:05', now)).toBeNull();
    expect(visitProblem('', '09:00', now)).toMatch(/Choose the day and time/);
  });

  it('lets a job be marked done only once its visit has started', () => {
    const now = new Date('2030-01-15T01:00:00Z');

    expect(visitHasStarted({ appointment_at: '2030-01-15T00:59:00Z' }, now)).toBe(true);
    expect(visitHasStarted({ appointment_at: '2030-01-15T01:01:00Z' }, now)).toBe(false);
    expect(visitHasStarted({ appointment_at: null }, now)).toBe(false);
  });
});
