'use client';

import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * Calls `listener` with true just before the page prints (or saves as PDF)
 * and with false afterwards. Returns a function that stops listening.
 */
export function onPrintChange(target: EventTarget, listener: (printing: boolean) => void): () => void {
  const before = () => listener(true);
  const after = () => listener(false);
  target.addEventListener('beforeprint', before);
  target.addEventListener('afterprint', after);
  return () => {
    target.removeEventListener('beforeprint', before);
    target.removeEventListener('afterprint', after);
  };
}

/** True while the page is printing, so a list paged with "Show more" can print in full. */
export function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  // The browser lays out the printout as soon as beforeprint returns, so the
  // full list has to reach the DOM synchronously.
  useEffect(() => onPrintChange(window, (value) => {
    if (value) flushSync(() => setPrinting(true));
    else setPrinting(false);
  }), []);
  return printing;
}

/** Every row on paper; on screen, the rows revealed so far. */
export function visibleRows<T>(rows: T[], limit: number, printing: boolean): T[] {
  return printing ? rows : rows.slice(0, limit);
}

/** "Showing 10 of 14 bookings", so a printout never hides that more exist. */
export function shownCount(shown: number, total: number, noun: string, plural = `${noun}s`): string {
  return `Showing ${shown} of ${total} ${total === 1 ? noun : plural}`;
}
