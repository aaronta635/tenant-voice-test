import type { Availability } from './api';

// The weekly editor shows one window per weekday, but nothing stops a weekday
// from collecting several saved rows (two tabs saving, or a create retried
// after a lost response). These helpers treat every saved row for a weekday
// as the baseline, so the editor never leaves a hidden window bookable.

export type DayDraft = { id?: string; enabled: boolean; start_time: string; end_time: string };

/** API times may carry seconds ("09:00:00"); <input type="time"> wants HH:MM. */
export function normalizeTime(value: string): string {
  return value.slice(0, 5);
}

/** A weekday's saved rows: open windows first, then by start time. */
function rowsForDay(rows: Availability[], day: number): Availability[] {
  return rows
    .filter((row) => row.day_of_week === day)
    .sort((a, b) => Number(b.is_available) - Number(a.is_available) || a.start_time.localeCompare(b.start_time));
}

/** The window the editor shows for a weekday: its earliest open one, if any. */
export function dayDraft(rows: Availability[], day: number): DayDraft {
  const [shown] = rowsForDay(rows, day);
  if (!shown) return { enabled: false, start_time: '09:00', end_time: '17:00' };
  return { id: shown.id, enabled: shown.is_available, start_time: normalizeTime(shown.start_time), end_time: normalizeTime(shown.end_time) };
}

/** Open windows saved for a weekday besides the one the editor shows. */
export function hiddenWindows(rows: Availability[], day: number): Availability[] {
  return rowsForDay(rows, day).slice(1).filter((row) => row.is_available);
}

/**
 * What saving a weekday must do so its saved rows match the draft exactly:
 * update (or create, when `keep` is null) the window shown, and delete every
 * other row. A closed day keeps nothing.
 */
export function dayChanges(draft: DayDraft, rows: Availability[], day: number): { keep: Availability | null; save: boolean; remove: Availability[] } {
  const saved = rowsForDay(rows, day);
  if (!draft.enabled) return { keep: null, save: false, remove: saved };
  const keep = saved.find((row) => row.id === draft.id) ?? saved[0] ?? null;
  const save = !keep || !keep.is_available || normalizeTime(keep.start_time) !== draft.start_time || normalizeTime(keep.end_time) !== draft.end_time;
  return { keep, save, remove: saved.filter((row) => row !== keep) };
}

/** Whether saving would change what clients can book on this weekday. */
export function dayIsDirty(draft: DayDraft, rows: Availability[], day: number): boolean {
  const { save, remove } = dayChanges(draft, rows, day);
  return save || remove.some((row) => row.is_available);
}
