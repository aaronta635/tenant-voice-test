// Inspection times, bookings and records (backend /inspections routes, R13).
// Every booking and decision goes through the mobile app's functions, which
// check ownership and state again and send the notices. property_id is the
// listing's id, as everywhere on the web.

import { apiFetch } from './api';

/** mobile_inspection_slots.status */
export type SlotStatus = 'open' | 'held' | 'booked' | 'cancelled';
/** mobile_inspection_bookings.status */
export type BookingStatus = 'pending' | 'accepted' | 'rejected' | 'reschedule_requested' | 'cancelled';
/** mobile_inspections.status */
export type RecordStatus = 'Scheduled' | 'Completed' | 'Cancelled';

export type InspectionSlot = {
  id: string;
  property_id: string;
  owner_id: string | null;
  starts_at: string;
  duration_minutes: number;
  status: SlotStatus;
  property_title: string | null;
  /** The street address; null for a visitor who is signed out. */
  address: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type InspectionBooking = {
  id: string;
  slot_id: string;
  property_id: string;
  owner_id: string;
  tenant_id: string;
  status: BookingStatus;
  note: string | null;
  starts_at: string;
  duration_minutes: number;
  slot_status: SlotStatus;
  property_title: string | null;
  address: string | null;
  tenant_name: string | null;
  owner_name: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type OwnerInspections = { slots: InspectionSlot[]; bookings: InspectionBooking[] };

export type InspectionHome = {
  property_id: string;
  title: string | null;
  address: string | null;
  owner_id: string | null;
  owner_name: string | null;
  open_slot_count: number;
};

export const RECORD_TYPES = ['Open home', 'Private viewing', 'Routine inspection', 'Entry condition', 'Exit condition'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export type InspectionRecord = {
  id: string;
  property_id: string;
  property_title: string | null;
  address: string | null;
  type: RecordType | string;
  scheduled_at: string;
  attendee_id: string | null;
  attendee_name: string | null;
  /** The meeting link of a remote inspection, and the findings. */
  notes: string | null;
  status: RecordStatus;
  history: { status: string | null; note: string | null; at: string | null }[];
  /** An attendee's record: whether its listing page opens. Absent for the owner. */
  listed?: boolean | null;
};

/** A time is sent as typed in a datetime-local field: Sydney wall-clock time. */
export type RecordInput = { type: string; scheduled_at: string; attendee_id: string | null; notes: string | null };

export type InspectionAttendee = { user_id: string; name: string };

export type Decision = 'accept' | 'reject' | 'reschedule';

const id = encodeURIComponent;

export const inspectionsApi = {
  /** Anyone: a listed home's open times, without the street address. */
  publicSlots: (propertyId: string) =>
    apiFetch<InspectionSlot[]>(`/properties/${id(propertyId)}/inspections`, { auth: false }),

  // Tenants
  openSlots: (propertyId: string) => apiFetch<InspectionSlot[]>(`/properties/${id(propertyId)}/inspection-slots`),
  book: (slotId: string, note: string | null) =>
    apiFetch<InspectionBooking>(`/inspection-slots/${id(slotId)}/bookings`, { method: 'POST', body: { note } }),
  myBookings: () => apiFetch<InspectionBooking[]>('/me/inspection-bookings'),
  homes: () => apiFetch<InspectionHome[]>('/me/inspection-homes'),

  // Owners
  owner: (propertyId?: string) =>
    apiFetch<OwnerInspections>('/me/inspections', { query: { property_id: propertyId } }),
  createSlots: (propertyId: string, startsAt: string[], durationMinutes: number) =>
    apiFetch<InspectionSlot[]>(`/me/properties/${id(propertyId)}/inspection-slots`, {
      method: 'POST',
      body: { starts_at: startsAt, duration_minutes: durationMinutes },
    }),
  cancelSlot: (slotId: string) => apiFetch<InspectionSlot>(`/inspection-slots/${id(slotId)}/cancel`, { method: 'POST' }),
  decide: (bookingId: string, decision: Decision) =>
    apiFetch<InspectionBooking>(`/inspection-bookings/${id(bookingId)}/decision`, { method: 'POST', body: { decision } }),

  // Records: an owner's, or for a tenant the ones they are invited to.
  records: (propertyId?: string) =>
    apiFetch<InspectionRecord[]>('/me/inspection-records', { query: { property_id: propertyId } }),
  attendees: (propertyId: string) =>
    apiFetch<InspectionAttendee[]>(`/me/properties/${id(propertyId)}/inspection-attendees`),
  createRecord: (propertyId: string, input: RecordInput) =>
    apiFetch<InspectionRecord>(`/me/properties/${id(propertyId)}/inspection-records`, { method: 'POST', body: input }),
  updateRecord: (recordId: string, input: RecordInput) =>
    apiFetch<InspectionRecord>(`/inspection-records/${id(recordId)}`, { method: 'PUT', body: input }),
  setRecordStatus: (recordId: string, status: 'Completed' | 'Cancelled', note: string | null) =>
    apiFetch<InspectionRecord>(`/inspection-records/${id(recordId)}/status`, { method: 'POST', body: { status, note } }),
};

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
export const SLOT_STATUS_LABELS: Record<SlotStatus, string> = {
  open: 'Open',
  held: 'Requested',
  booked: 'Booked',
  cancelled: 'Cancelled',
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Waiting for the owner',
  accepted: 'Accepted',
  rejected: 'Declined',
  reschedule_requested: 'Pick another time',
  cancelled: 'Cancelled',
};

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  Scheduled: 'Scheduled',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
};

type Tone = 'good' | 'waiting' | 'stopped' | 'open';
const TONE_STYLES: Record<Tone, string> = {
  good: 'border-success text-success',
  waiting: 'border-warning text-warning',
  stopped: 'border-text-body text-text-body',
  open: 'border-primary-strong text-primary-strong',
};
const SLOT_TONES: Record<SlotStatus, Tone> = { open: 'open', held: 'waiting', booked: 'good', cancelled: 'stopped' };
const BOOKING_TONES: Record<BookingStatus, Tone> = {
  pending: 'waiting', accepted: 'good', rejected: 'stopped', reschedule_requested: 'waiting', cancelled: 'stopped',
};
const RECORD_TONES: Record<RecordStatus, Tone> = { Scheduled: 'open', Completed: 'good', Cancelled: 'stopped' };

/** A status pill's label and colours; an unknown status reads as itself. */
export function statusPill(kind: 'slot' | 'booking' | 'record', status: string): { label: string; className: string } {
  const labels: Record<string, string> = kind === 'slot' ? SLOT_STATUS_LABELS : kind === 'booking' ? BOOKING_STATUS_LABELS : RECORD_STATUS_LABELS;
  const tones: Record<string, Tone> = kind === 'slot' ? SLOT_TONES : kind === 'booking' ? BOOKING_TONES : RECORD_TONES;
  return { label: labels[status] ?? status, className: TONE_STYLES[tones[status] ?? 'stopped'] };
}

/** Whether a booking still holds the home for the tenant: no other time can be booked while it does. */
export function isActiveBooking(booking: Pick<InspectionBooking, 'status'>): boolean {
  return booking.status === 'pending' || booking.status === 'accepted';
}

// ---------------------------------------------------------------------------
// Sydney time
// ---------------------------------------------------------------------------
const ZONE = 'Australia/Sydney';

/** "Sat, 6 Nov, 10:00 am AEDT": always Sydney time, with the zone that applies that day. */
export function inspectionTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-AU', {
    timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

/** "30 min", "1 hr", "1 hr 30 min". */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/** The current Sydney time as a datetime-local value ("2026-10-23T15:20"), for a field's min. */
export function sydneyNowLocal(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Inspection times go in 5-minute steps, the time fields' step. */
export const TIME_STEP_SECONDS = 300;

/**
 * The first 5-minute mark after now, in Sydney time, for a time field's min. A datetime-local field
 * counts its step from its min, so a min of the current minute (15:22) would make 10:00 a step
 * mismatch. Sydney is a whole number of hours from UTC, so a 5-minute mark in UTC is one there too.
 */
export function sydneyMinLocal(now: Date = new Date()): string {
  const step = TIME_STEP_SECONDS * 1000;
  return sydneyNowLocal(new Date(Math.floor(now.getTime() / step) * step + step));
}

/** An instant as a Sydney datetime-local value, to edit it in a field. */
export function sydneyLocalOf(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : sydneyNowLocal(date);
}

export const DURATIONS = [15, 30, 45, 60, 90, 120] as const;
/** mobile_inspection_create_slots takes up to 20 times at once. */
export const MAX_TIMES = 20;
export const NOTE_LIMIT = 500;
export const RECORD_NOTES_LIMIT = 1000;
