import { describe, expect, it } from 'vitest';
import type { Booking } from './api';
import { bookingHasStarted, bookingIsOverdue, enquiryDatePassed, localDateKey, providerJobs, upcomingBookings } from './provider-schedule';

describe('provider schedule', () => {
  it('keeps local dates at a month boundary', () => {
    expect(localDateKey(new Date('2026-09-30T14:15:00Z'))).toBe('2026-10-01');
  });

  it('keeps overdue jobs and excludes closed jobs, sorts same-day times, and keeps undated times last', () => {
    const rows = [
      { id: 'past', status: 'confirmed', scheduled_date: '2026-09-22' },
      { id: 'late', status: 'confirmed', scheduled_date: '2026-09-23', scheduled_time: '15:00:00' },
      { id: 'cancelled', status: 'cancelled', scheduled_date: '2026-09-24' },
      { id: 'done', status: 'completed', scheduled_date: '2026-09-23' },
      { id: 'early', status: 'in_progress', scheduled_date: '2026-09-23', scheduled_time: '09:00:00' },
      { id: 'unknown-time', status: 'confirmed', scheduled_date: '2026-09-23' },
      { id: 'unscheduled', status: 'new_enquiry', scheduled_date: null },
      { id: 'tomorrow', status: 'new_enquiry', scheduled_date: '2026-09-24' },
    ] as Booking[];
    const order = rows.map((b) => b.id);
    expect(upcomingBookings(rows, new Date(2026, 8, 23)).map((b) => b.id))
      .toEqual(['past', 'early', 'late', 'unknown-time', 'tomorrow']);
    expect(rows.map((b) => b.id)).toEqual(order);
  });

  it("keeps the provider's own requests to other providers out of their jobs", () => {
    const rows = [
      { id: 'job', status: 'new_enquiry', provider_id: 'daniel', client_id: 'amelia-profile' },
      { id: 'my-request', status: 'new_enquiry', provider_id: 'amelia', client_id: 'daniel-profile' },
    ] as Booking[];
    expect(providerJobs(rows, 'daniel').map((b) => b.id)).toEqual(['job']);
    expect(providerJobs(rows, null)).toEqual([]);
    expect(providerJobs(rows, undefined)).toEqual([]);
  });
});


it('allows work only from the Sydney appointment time', () => {
  const booking = {scheduled_date:'2026-10-04',scheduled_time:'03:30:00'};
  expect(bookingHasStarted(booking,new Date('2026-10-03T16:29:00Z'))).toBe(false);
  expect(bookingHasStarted(booking,new Date('2026-10-03T16:30:00Z'))).toBe(true);
  expect(bookingHasStarted({scheduled_date:null,scheduled_time:null})).toBe(false);
});

it('calls a job overdue only once its Sydney day has passed, like the Active bookings card', () => {
  const noon = new Date('2026-10-21T01:00:00Z'); // 12:00 pm on 21 Oct in Sydney
  expect(bookingIsOverdue({ status: 'in_progress', scheduled_date: '2026-10-21' }, noon)).toBe(false);
  expect(bookingIsOverdue({ status: 'confirmed', scheduled_date: '2026-10-21' }, noon)).toBe(false);
  expect(bookingIsOverdue({ status: 'in_progress', scheduled_date: '2026-10-20' }, noon)).toBe(true);
  expect(bookingIsOverdue({ status: 'confirmed', scheduled_date: '2026-10-20' }, noon)).toBe(true);
  // The card counts accepted jobs only, so an unanswered enquiry is never overdue.
  expect(bookingIsOverdue({ status: 'new_enquiry', scheduled_date: '2026-10-19' }, noon)).toBe(false);
  expect(bookingIsOverdue({ status: 'completed', scheduled_date: '2026-10-20' }, noon)).toBe(false);
  expect(bookingIsOverdue({ status: 'confirmed', scheduled_date: null }, noon)).toBe(false);
  // 11:30 pm on 20 Oct in Sydney is still the appointment day.
  expect(bookingIsOverdue({ status: 'confirmed', scheduled_date: '2026-10-20' }, new Date('2026-10-20T12:30:00Z'))).toBe(false);
});

it('says an unanswered enquiry is past its date once its Sydney day has passed', () => {
  const noon = new Date('2026-10-21T01:00:00Z'); // 12:00 pm on 21 Oct in Sydney
  expect(enquiryDatePassed({ status: 'new_enquiry', scheduled_date: '2026-10-20' }, noon)).toBe(true);
  expect(enquiryDatePassed({ status: 'new_enquiry', scheduled_date: '2026-10-21' }, noon)).toBe(false);
  expect(enquiryDatePassed({ status: 'new_enquiry', scheduled_date: null }, noon)).toBe(false);
  // An accepted job past its day is overdue instead.
  expect(enquiryDatePassed({ status: 'confirmed', scheduled_date: '2026-10-20' }, noon)).toBe(false);
  // 11:30 pm on 20 Oct in Sydney is still the day asked for.
  expect(enquiryDatePassed({ status: 'new_enquiry', scheduled_date: '2026-10-20' }, new Date('2026-10-20T12:30:00Z'))).toBe(false);
});
