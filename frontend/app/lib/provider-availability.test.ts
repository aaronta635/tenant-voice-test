import { describe, expect, it } from 'vitest';
import type { Availability } from './api';
import { dayChanges, dayDraft, dayIsDirty, hiddenWindows } from './provider-availability';

function row(id: string, day: number, start: string, end: string, isAvailable = true): Availability {
  return { id, provider_id: 'provider', day_of_week: day, start_time: `${start}:00`, end_time: `${end}:00`, is_available: isAvailable };
}

describe('availability with two saved windows on one weekday', () => {
  // Tab A saved Monday 09:00-12:00, then a stale tab B created 13:00-17:00 as a second row.
  const rows = [row('b', 1, '13:00', '17:00'), row('a', 1, '09:00', '12:00'), row('tue', 2, '09:00', '17:00')];

  it('shows the earliest window and reports the other, which clients can still book', () => {
    expect(dayDraft(rows, 1)).toEqual({ id: 'a', enabled: true, start_time: '09:00', end_time: '12:00' });
    expect(hiddenWindows(rows, 1).map((item) => item.id)).toEqual(['b']);
    expect(hiddenWindows(rows, 2)).toEqual([]);
  });

  it('treats the hidden window as unsaved and deletes it on save', () => {
    const shown = dayDraft(rows, 1);
    expect(dayIsDirty(shown, rows, 1)).toBe(true);
    expect(dayChanges(shown, rows, 1)).toEqual({ keep: rows[1], save: false, remove: [rows[0]] });
  });

  it('deletes every saved window when the day is unticked', () => {
    const closed = { ...dayDraft(rows, 1), enabled: false };
    expect(dayIsDirty(closed, rows, 1)).toBe(true);
    expect(dayChanges(closed, rows, 1).remove.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('updates the shown window in place and still removes the other', () => {
    const edited = { ...dayDraft(rows, 1), end_time: '13:00' };
    const { keep, save, remove } = dayChanges(edited, rows, 1);
    expect([keep?.id, save, remove.map((item) => item.id)]).toEqual(['a', true, ['b']]);
  });
});

describe('availability with one window per weekday', () => {
  const rows = [row('tue', 2, '09:00', '17:00'), row('wed-closed', 3, '09:00', '17:00', false)];

  it('is clean while the draft matches the saved window', () => {
    expect(dayIsDirty(dayDraft(rows, 2), rows, 2)).toBe(false);
    expect(dayChanges(dayDraft(rows, 2), rows, 2)).toEqual({ keep: rows[0], save: false, remove: [] });
  });

  it('creates a window for a newly opened day', () => {
    const opened = { ...dayDraft(rows, 4), enabled: true };
    expect(dayChanges(opened, rows, 4)).toEqual({ keep: null, save: true, remove: [] });
    expect(dayIsDirty(dayDraft(rows, 4), rows, 4)).toBe(false);
  });

  it('reopens a closed saved row instead of adding another', () => {
    const closed = dayDraft(rows, 3);
    expect(closed).toEqual({ id: 'wed-closed', enabled: false, start_time: '09:00', end_time: '17:00' });
    expect(dayIsDirty(closed, rows, 3)).toBe(false);
    expect(dayChanges({ ...closed, enabled: true }, rows, 3)).toEqual({ keep: rows[1], save: true, remove: [] });
  });
});
