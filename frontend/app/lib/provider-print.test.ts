import { describe, expect, it } from 'vitest';
import { onPrintChange, shownCount, visibleRows } from './provider-print';

describe('printing a paged list', () => {
  const confirmed = Array.from({ length: 14 }, (_, index) => `job-${index + 1}`);

  it('prints every row in the view, not only the 10 revealed on screen', () => {
    expect(visibleRows(confirmed, 10, false)).toHaveLength(10);
    expect(visibleRows(confirmed, 10, true)).toEqual(confirmed);
  });

  it('switches to the full list for the printout and back afterwards', () => {
    const page = new EventTarget();
    const states: boolean[] = [];
    const stop = onPrintChange(page, (printing) => states.push(printing));
    page.dispatchEvent(new Event('beforeprint'));
    page.dispatchEvent(new Event('afterprint'));
    stop();
    page.dispatchEvent(new Event('beforeprint'));
    expect(states).toEqual([true, false]);
  });

  it('says how many rows are shown out of how many', () => {
    expect(shownCount(10, 14, 'booking')).toBe('Showing 10 of 14 bookings');
    expect(shownCount(1, 1, 'invoice')).toBe('Showing 1 of 1 invoice');
  });
});
