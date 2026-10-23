import type { Availability } from './api';
import { formatTime } from './format';
import { localDateKey } from './provider-schedule';

export type BusyTime = { date: string; start_time: string; end_time: string };
export function minutesOf(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + (minutes || 0);
}
export function nextBookableSlots(availability: Availability[], durationMinutes: number, busy: BusyTime[], now = new Date()) {
  const slots: { value: string; label: string }[] = [];
  const windows = availability.filter((window) => window.is_available);
  // Calendar arithmetic in UTC keeps dates stable across Sydney DST transitions.
  const cursor = new Date(`${localDateKey(now)}T12:00:00Z`);
  for (let day = 1; day <= 14; day += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const date = cursor.toISOString().slice(0, 10);
    const dayLabel = cursor.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    for (const window of windows.filter((item) => item.day_of_week === cursor.getUTCDay())) {
      for (let start = minutesOf(window.start_time); start + durationMinutes <= minutesOf(window.end_time); start += 60) {
        if (busy.some((item) => item.date === date && start < minutesOf(item.end_time) && start + durationMinutes > minutesOf(item.start_time))) continue;
        const time = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}:00`;
        slots.push({ value: `${date}|${time}`, label: `${dayLabel} · ${formatTime(time)}` });
      }
    }
  }
  return slots;
}
