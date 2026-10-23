import { describe, expect, it } from 'vitest';
import { nextBookableSlots } from './booking-slots';
import type { Availability } from './api';
const availability = [{ day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00', is_available: true }] as Availability[];
describe('public booking slots', () => {
  it('excludes identical and partially overlapping intervals but permits touching boundaries', () => {
    const slots = nextBookableSlots(availability,120,[{date:'2026-10-05',start_time:'12:00:00',end_time:'13:00:00'}],new Date('2026-10-03T00:00:00Z')).map((slot) => slot.value);
    expect(slots).not.toContain('2026-10-05|11:00:00');
    expect(slots).not.toContain('2026-10-05|12:00:00');
    expect(slots).toContain('2026-10-05|10:00:00');
    expect(slots).toContain('2026-10-05|13:00:00');
    expect(slots).not.toContain('2026-10-05|16:00:00');
  });
  it('lists the full two-week window without a first-40-times cap', () => {
    const everyDay = Array.from({length:7},(_,day_of_week) => ({...availability[0],day_of_week}));
    expect(nextBookableSlots(everyDay,60,[],new Date('2026-10-03T00:00:00Z'))).toHaveLength(112);
  });
});
