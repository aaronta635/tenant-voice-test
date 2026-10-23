'use client';

// "Book an inspection" for one listing (R13), on the listing page and in the
// rental pipeline. A tenant books one of the times the owner published; the
// booking is a mobile_inspection_book call, never a chat message. Anyone
// else sees the times: signed out, with a way to sign in; the owner, with
// a link to manage them.

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import StatusPill from '@/app/components/inspections/StatusPill';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import {
  durationLabel,
  inspectionTime,
  inspectionsApi,
  isActiveBooking,
  NOTE_LIMIT,
  type InspectionBooking as Booking,
  type InspectionSlot,
} from '@/app/lib/inspections';

type Props = {
  propertyId: string;
  /** The viewer's web role; null when signed out. */
  role: string | null;
  isOwner: boolean;
  /** Where a signed-out visitor signs in and comes back. */
  signInHref: string;
  /** Where the owner manages the times. */
  manageHref: string;
  /** Where a tenant sees all their inspections. */
  listHref?: string;
};

type Loaded = { key: string; slots: InspectionSlot[]; booking: Booking | null };

const BOOKING_HELP: Record<string, string> = {
  pending: 'The owner will accept it, decline it or ask you to pick another time. You will get a notification.',
  accepted: 'The owner accepted this viewing. It is not a decision on a rental application.',
  reschedule_requested: 'The owner asked you to pick another time.',
  rejected: 'The owner declined this time. You can ask for another one.',
};

/** The tenant's latest booking for this home, if any. */
function latestFor(bookings: Booking[], propertyId: string): Booking | null {
  const mine = bookings.filter((booking) => booking.property_id === propertyId && booking.status !== 'cancelled');
  return mine.find(isActiveBooking) ?? mine.find((booking) => booking.status === 'reschedule_requested') ?? mine[0] ?? null;
}

export default function InspectionBooking({ propertyId, role, isOwner, signInHref, manageHref, listHref = '/tenant/inspections' }: Props) {
  const canBook = role === 'tenant' && !isOwner;
  const key = `${propertyId}:${canBook ? 'tenant' : 'public'}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  // Times that answered 409. A slot whose booking the owner asked to reschedule shows as open, but its
  // unique index still holds it for that tenant (docs/shared-db.md): offering it again fails every time.
  const [taken, setTaken] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    let active = true;
    const read = canBook
      ? Promise.all([inspectionsApi.openSlots(propertyId), inspectionsApi.myBookings()])
        .then(([slots, bookings]) => ({ key, slots, booking: latestFor(bookings, propertyId) }))
      : inspectionsApi.publicSlots(propertyId).then((slots) => ({ key, slots, booking: null }));
    read.then(
      (result) => { if (active) { setLoaded(result); setFailure(null); } },
      (err) => {
        if (active) setFailure({ key, message: err instanceof ApiError ? err.message : 'Inspection times could not be loaded.' });
      },
    );
    return () => { active = false; };
  }, [propertyId, canBook, key, attempt]);

  const current = loaded?.key === key ? loaded : null;
  const failed = failure?.key === key ? failure : null;
  const slots = (current?.slots ?? []).filter((slot) => !taken.includes(slot.id));
  const booking = current?.booking ?? null;
  const holdsHome = booking ? isActiveBooking(booking) : false;
  const chosen = slots.find((slot) => slot.id === choice) ?? slots[0] ?? null;

  async function book(event: FormEvent) {
    event.preventDefault();
    if (!chosen || busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await inspectionsApi.book(chosen.id, note.trim() || null);
      setLoaded((previous) => previous && {
        ...previous,
        slots: previous.slots.filter((slot) => slot.id !== chosen.id),
        booking: created,
      });
      setNote('');
      setChoice(null);
      setSuccess(`Requested ${inspectionTime(created.starts_at)}. The owner has been told.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The inspection could not be booked. Please try again.');
      if (err instanceof ApiError && err.status === 409) {
        setTaken((ids) => [...ids, chosen.id]);
        setChoice(null);
      }
      // The time may have gone: show what is still open.
      if (err instanceof ApiError && (err.status === 409 || err.status === 422)) setAttempt((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  if (failed) {
    return (
      <div className="mt-3 space-y-3">
        <p role="alert" className="text-sm text-danger">{failed.message}</p>
        <Button variant="secondary" size="sm" onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}>Try again</Button>
      </div>
    );
  }
  if (!current) return <p role="status" className="mt-3 text-sm text-text-body">Loading inspection times…</p>;

  return (
    <div className="mt-3 space-y-4">
      {booking ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-text-dark">Your inspection</p>
            <StatusPill kind="booking" status={booking.status} />
          </div>
          <p className="mt-1 text-text-dark">{inspectionTime(booking.starts_at)} · {durationLabel(booking.duration_minutes)}</p>
          {BOOKING_HELP[booking.status] ? <p className="mt-1 text-text-body">{BOOKING_HELP[booking.status]}</p> : null}
          <Link href={listHref} className="mt-1 inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
            All my inspections
          </Link>
        </div>
      ) : null}

      {slots.length === 0 ? (
        <p className="text-sm text-text-body">
          {holdsHome ? 'No other inspection times are open.' : 'No inspection times published yet — message the landlord to arrange one.'}
        </p>
      ) : canBook && !holdsHome ? (
        <form onSubmit={(event) => void book(event)} className="space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold text-text-dark">Choose a time (Sydney time)</legend>
            <ul className="mt-2 space-y-2">
              {slots.map((slot) => {
                const picked = chosen?.id === slot.id;
                return (
                  <li key={slot.id}>
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => setChoice(slot.id)}
                      className={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium text-text-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong ${picked ? 'border-primary-strong bg-surface' : 'border-border bg-white hover:border-primary-strong'}`}
                    >
                      <span aria-hidden className={`size-4 shrink-0 rounded-full border-2 ${picked ? 'border-[5px] border-primary-strong' : 'border-control-border'}`} />
                      <span className="min-w-0 break-words">{inspectionTime(slot.starts_at)} · {durationLabel(slot.duration_minutes)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div>
            <label htmlFor={`inspection-note-${propertyId}`} className="text-sm font-semibold text-text-dark">
              Note for the owner <span className="font-normal text-text-body">(optional)</span>
            </label>
            <textarea
              id={`inspection-note-${propertyId}`}
              value={note}
              maxLength={NOTE_LIMIT}
              rows={3}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm text-text-dark"
            />
            <p className="text-xs text-text-body">{note.length}/{NOTE_LIMIT}</p>
          </div>
          <Button type="submit" fullWidth disabled={busy || !chosen}>{busy ? 'Booking…' : 'Book an inspection'}</Button>
        </form>
      ) : (
        <ul className="space-y-2">
          {slots.map((slot) => (
            <li key={slot.id} className="rounded-xl border border-border px-4 py-3 text-sm font-medium text-text-dark">
              {inspectionTime(slot.starts_at)} · {durationLabel(slot.duration_minutes)}
            </li>
          ))}
        </ul>
      )}

      {isOwner ? (
        <ButtonLink href={manageHref} variant="secondary" fullWidth>Manage inspection times</ButtonLink>
      ) : !canBook && slots.length > 0 ? (
        role === null ? (
          <ButtonLink href={signInHref} variant="secondary" fullWidth>Sign in to book an inspection</ButtonLink>
        ) : (
          <p className="text-sm text-text-body">Inspections are booked from a tenant account.</p>
        )
      ) : null}

      <FormMessage error={error} success={success} />
    </div>
  );
}
