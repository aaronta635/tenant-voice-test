import type { Booking } from './api';

export const ACTIVE_BOOKING_STATUSES = new Set(['new_enquiry', 'confirmed', 'in_progress']);

/** Booking dates are local calendar dates, not UTC instants. */
export function localDateKey(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

/**
 * Bookings the provider was hired for. GET /bookings also returns the
 * provider's own requests to other providers; those belong under My booking
 * requests, not in their jobs, counts or calendar.
 */
export function providerJobs(bookings: Booking[], providerId: string | null | undefined): Booking[] {
  return providerId ? bookings.filter((booking) => booking.provider_id === providerId) : [];
}

export function upcomingBookings(bookings: Booking[], now = new Date()): Booking[] {
  void now;
  return bookings
    .filter((booking) => ACTIVE_BOOKING_STATUSES.has(booking.status) &&
      !!booking.scheduled_date)
    .sort((a, b) => `${a.scheduled_date} ${a.scheduled_time ?? '23:59:59'}`
      .localeCompare(`${b.scheduled_date} ${b.scheduled_time ?? '23:59:59'}`));
}

/** Accepted, unfinished jobs: what the Active bookings card counts. */
const ACCEPTED_JOB_STATUSES = new Set(['confirmed', 'in_progress']);

/**
 * An accepted job still open after its appointment day (Sydney): the rule the
 * Active bookings card uses for its overdue count. A job started today is not
 * overdue, however long it has been running, and an enquiry is not a job yet.
 */
export function bookingIsOverdue(booking: Pick<Booking, 'status' | 'scheduled_date'>, now = new Date()): boolean {
  return ACCEPTED_JOB_STATUSES.has(booking.status) && !!booking.scheduled_date && booking.scheduled_date < localDateKey(now);
}

/**
 * An enquiry still unanswered after the day it asked for (Sydney). It is not a
 * job, so never overdue, but that day can no longer be kept.
 */
export function enquiryDatePassed(booking: Pick<Booking, 'status' | 'scheduled_date'>, now = new Date()): boolean {
  return booking.status === 'new_enquiry' && !!booking.scheduled_date && booking.scheduled_date < localDateKey(now);
}

export function bookingHasStarted(booking: Pick<Booking, 'scheduled_date' | 'scheduled_time'>, now = new Date()): boolean {
  if (!booking.scheduled_date) return false;
  const today = localDateKey(now);
  if (booking.scheduled_date !== today) return booking.scheduled_date < today;
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Australia/Sydney', hour12: false });
  return (booking.scheduled_time ?? '00:00:00').slice(0, 5) <= time.slice(0, 5);
}
