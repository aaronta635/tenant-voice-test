import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatDate,
  formatMoney,
  formatMoneyExact,
  formatRating,
  formatSchedule,
  formatServicePrice,
  formatTime,
  messageTimestamp,
  initialsOf,
  relativeTime,
} from './format';

describe('initialsOf', () => {
  it('takes first and last initials of a full name', () => {
    expect(initialsOf('Nguyen Ta')).toBe('NT');
    expect(initialsOf('Thi Ngoc Anh Nguyen')).toBe('TN');
  });

  it('uses the first two letters of a single name', () => {
    expect(initialsOf('amelia')).toBe('AM');
  });

  it('falls back for empty input', () => {
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf(undefined, 'NA')).toBe('NA');
  });
});

describe('formatMoney', () => {
  it('formats with thousands separators', () => {
    expect(formatMoney(1250)).toBe('$1,250');
    expect(formatMoney(99.5, '/hr')).toBe('$99.50/hr');
  });

  it('shows both cent digits whenever an amount has cents', () => {
    expect(formatMoney(256.2)).toBe('$256.20');
    expect(formatMoney(980.1)).toBe(formatMoneyExact(980.1));
    expect(formatMoney(99.999)).toBe('$100');
    expect(formatServicePrice(99.5, 'hourly')).toBe('$99.50 per hour');
  });

  it('puts a minus sign before the dollar sign', () => {
    expect(formatMoney(-40)).toBe('-$40');
    expect(formatMoneyExact(-12.5)).toBe('-$12.50');
    expect(formatMoneyExact(-0.001)).toBe('$0.00');
  });

  it('renders a dash for missing values', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
  });
});

describe('formatMoneyExact', () => {
  it('always shows two decimals', () => {
    expect(formatMoneyExact(10)).toBe('$10.00');
    expect(formatMoneyExact(10.5)).toBe('$10.50');
    expect(formatMoneyExact(1200.5)).toBe('$1,200.50');
  });
});

describe('formatDate', () => {
  it('formats a date-only string without timezone drift', () => {
    expect(formatDate('2026-08-27')).toBe('27 Aug 2026');
  });

  it('dashes invalid and empty input', () => {
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDate('2026-02-30')).toBe('—');
    expect(formatDate(null)).toBe('—');
  });
});

describe('formatSchedule', () => {
  it('says so when there is no date yet', () => {
    expect(formatSchedule(null, null)).toBe('Time to be confirmed');
  });

  it('combines day and time', () => {
    const result = formatSchedule('2026-08-25', '10:00:00');
    expect(result).toContain('25 Aug');
    expect(result).toContain('·');
    expect(result.toLowerCase()).toMatch(/10:00\s?am/);
  });
});

describe('relativeTime', () => {
  afterEach(() => vi.useRealTimers());

  it('buckets by age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'));
    expect(relativeTime('2026-08-27T11:59:40Z')).toBe('Just now');
    expect(relativeTime('2026-08-27T11:30:00Z')).toBe('30m ago');
    expect(relativeTime('2026-08-27T07:00:00Z')).toBe('5h ago');
    expect(relativeTime('2026-08-25T12:00:00Z')).toBe('2d ago');
  });

  it('is empty for missing input', () => {
    expect(relativeTime(null)).toBe('');
    expect(relativeTime('garbage')).toBe('');
  });
});

describe('formatRating', () => {
  it('shows one decimal once there are reviews', () => {
    expect(formatRating(4.75, 12)).toBe('4.8');
  });

  it('says New instead of a fake 0.0 for unreviewed providers', () => {
    expect(formatRating(0, 0)).toBe('New');
    expect(formatRating(null, null)).toBe('New');
  });
});


describe('Sydney wall-clock dates', () => {
  afterEach(() => vi.useRealTimers());
  it('keeps a booking time stable across the spring DST gap', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T16:30:00Z'));
    expect(formatTime('02:30:00')).toBe('2:30 am');
    expect(formatTime('00:00')).toBe('12:00 am');
    expect(formatTime('24:00')).toBe('');
  });
  it('uses calendar yesterday even when a message is under 24 hours old', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T14:00:00Z'));
    expect(messageTimestamp('2026-10-04T11:30:00Z')).toMatch(/^Yesterday · 10:30\s?pm$/);
    expect(messageTimestamp('2026-10-04T13:15:00Z')).toMatch(/^12:15\s?am$/);
  });
});
