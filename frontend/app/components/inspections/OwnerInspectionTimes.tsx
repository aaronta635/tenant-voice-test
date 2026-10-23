'use client';

// An owner's inspection times and the requests for them (R13): publish times
// for a listing, cancel one, and accept, decline or ask to reschedule a
// request. Every action is a mobile function call; the list is read again
// after each, so it always shows what the database holds.

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import StatusPill from '@/app/components/inspections/StatusPill';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import {
  DURATIONS,
  durationLabel,
  inspectionTime,
  inspectionsApi,
  MAX_TIMES,
  sydneyMinLocal,
  TIME_STEP_SECONDS,
  type Decision,
  type InspectionBooking,
  type InspectionSlot,
  type OwnerInspections,
} from '@/app/lib/inspections';

type Props = {
  /** One listing's times, with the form to publish more; all of the owner's without it. */
  propertyId?: string;
};

const card = 'min-w-0 rounded-2xl border border-border bg-white p-5';
const DECISIONS: { decision: Decision; label: string; done: string }[] = [
  { decision: 'accept', label: 'Accept', done: 'Accepted: the time is booked and the tenant has been told.' },
  { decision: 'reject', label: 'Decline', done: 'Declined: the time is open again and the tenant has been told.' },
  { decision: 'reschedule', label: 'Ask to reschedule', done: 'The tenant has been asked to pick another time.' },
];

type Loaded = { key: string; data: OwnerInspections };

export default function OwnerInspectionTimes({ propertyId }: Props) {
  const key = propertyId ?? 'all';
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    inspectionsApi.owner(propertyId).then(
      (data) => { if (active) { setLoaded({ key, data }); setFailure(null); } },
      (err) => {
        if (active) setFailure({ key, message: err instanceof ApiError ? err.message : 'Inspection times could not be loaded.' });
      },
    );
    return () => { active = false; };
  }, [propertyId, key, attempt]);

  const current = loaded?.key === key ? loaded.data : null;
  const failed = failure?.key === key ? failure : null;
  const reload = () => setAttempt((value) => value + 1);

  async function run(id: string, action: () => Promise<unknown>, done: string) {
    setBusy(id);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(done);
      setConfirming(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
    } finally {
      setBusy(null);
      reload();
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {propertyId ? <PublishTimes propertyId={propertyId} onPublished={reload} /> : null}

      <section aria-labelledby="requests-heading" className={card}>
        <h2 id="requests-heading" className="font-heading text-h4 font-semibold text-text-dark">Inspection requests</h2>
        <FormMessage error={error} success={success} className="mt-2" />
        {failed ? (
          <LoadFailed message={failed.message} onRetry={() => { setFailure(null); reload(); }} />
        ) : !current ? (
          <p role="status" className="mt-3 text-sm text-text-body">Loading inspection requests…</p>
        ) : current.bookings.length === 0 ? (
          <p className="mt-3 text-sm text-text-body">No requests yet. Tenants ask for a time from the listing page.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {current.bookings.map((booking) => (
              <BookingRow
                key={booking.id}
                booking={booking}
                showProperty={!propertyId}
                busy={busy === booking.id}
                onDecide={(decision, done) => void run(booking.id, () => inspectionsApi.decide(booking.id, decision), done)}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="times-heading" className={card}>
        <h2 id="times-heading" className="font-heading text-h4 font-semibold text-text-dark">Inspection times</h2>
        <p className="mt-1 text-sm text-text-body">Times from the last two weeks and every time to come. All times are Sydney time.</p>
        {failed ? null : !current ? (
          <p role="status" className="mt-3 text-sm text-text-body">Loading inspection times…</p>
        ) : current.slots.length === 0 ? (
          <p className="mt-3 text-sm text-text-body">
            No inspection times yet.{' '}
            {propertyId ? 'Publish some above.' : "Publish them from a property's Inspections tab."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {current.slots.map((slot) => (
              <SlotRow
                key={slot.id}
                slot={slot}
                showProperty={!propertyId}
                busy={busy === slot.id}
                confirming={confirming === slot.id}
                onAsk={() => setConfirming(slot.id)}
                onKeep={() => setConfirming(null)}
                onCancel={() => void run(slot.id, () => inspectionsApi.cancelSlot(slot.id),
                  'Time cancelled. Anyone waiting on it has been told.')}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-3 space-y-3">
      <p role="alert" className="text-sm text-danger">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
    </div>
  );
}

function PropertyLink({ id, title }: { id: string; title: string | null }) {
  return (
    <Link href={`/owner/properties/${id}?tab=inspections`} className="font-semibold text-primary-strong underline">
      {title || 'Property'}
    </Link>
  );
}

function BookingRow({ booking, showProperty, busy, onDecide }: {
  booking: InspectionBooking;
  showProperty: boolean;
  busy: boolean;
  onDecide: (decision: Decision, done: string) => void;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-2 py-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words font-semibold text-text-dark">{booking.tenant_name || 'Tenant'}</p>
        <StatusPill kind="booking" status={booking.status} />
      </div>
      <p className="text-text-dark">{inspectionTime(booking.starts_at)} · {durationLabel(booking.duration_minutes)}</p>
      {showProperty ? <p><PropertyLink id={booking.property_id} title={booking.property_title} /></p> : null}
      {booking.note ? <p className="whitespace-pre-line break-words text-text-body">&ldquo;{booking.note}&rdquo;</p> : null}
      {booking.status === 'pending' ? (
        <div className="flex flex-wrap gap-2">
          {DECISIONS.map(({ decision, label, done }) => (
            <Button
              key={decision}
              size="sm"
              variant={decision === 'accept' ? 'primary' : 'secondary'}
              disabled={busy}
              aria-label={`${label}: ${booking.tenant_name || 'Tenant'}, ${inspectionTime(booking.starts_at)}`}
              onClick={() => onDecide(decision, done)}
            >
              {label}
            </Button>
          ))}
        </div>
      ) : booking.status === 'reschedule_requested' ? (
        <p className="text-text-body">Waiting for the tenant to pick another time. Until then, only they can book this time.</p>
      ) : null}
    </li>
  );
}

function SlotRow({ slot, showProperty, busy, confirming, onAsk, onKeep, onCancel }: {
  slot: InspectionSlot;
  showProperty: boolean;
  busy: boolean;
  confirming: boolean;
  onAsk: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const when = inspectionTime(slot.starts_at);
  const cancellable = slot.status === 'open' || slot.status === 'held';
  return (
    <li className="flex min-w-0 flex-col gap-2 py-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words font-semibold text-text-dark">{when} · {durationLabel(slot.duration_minutes)}</p>
        <StatusPill kind="slot" status={slot.status} />
      </div>
      {showProperty ? <p><PropertyLink id={slot.property_id} title={slot.property_title} /></p> : null}
      {slot.status === 'booked' ? <p className="text-text-body">Booked: an accepted viewing holds this time.</p> : null}
      {slot.status === 'held' ? <p className="text-text-body">A tenant asked for this time: decide their request above.</p> : null}
      {cancellable ? (
        confirming ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Cancel ${when}?`}>
            <p className="text-text-dark">Cancel this time? A request waiting on it is cancelled and the tenant told.</p>
            <Button size="sm" variant="destructive" disabled={busy} onClick={onCancel}>{busy ? 'Cancelling…' : 'Yes, cancel it'}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onKeep}>Keep it</Button>
          </div>
        ) : (
          <div>
            <Button size="sm" variant="secondary" aria-label={`Cancel the time ${when}`} onClick={onAsk}>Cancel time</Button>
          </div>
        )
      ) : null}
    </li>
  );
}

/** Up to 20 start times at once, typed in Sydney time, all of one length. */
function PublishTimes({ propertyId, onPublished }: { propertyId: string; onPublished: () => void }) {
  const [times, setTimes] = useState<string[]>(['']);
  const [duration, setDuration] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const min = sydneyMinLocal();

  function setTime(index: number, value: string) {
    setTimes((previous) => previous.map((time, at) => (at === index ? value : time)));
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    const chosen = times.map((time) => time.trim()).filter(Boolean);
    if (chosen.length === 0) {
      setError('Add at least one inspection time.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await inspectionsApi.createSlots(propertyId, chosen, duration);
      const skipped = new Set(chosen).size - created.length;
      setSuccess(`Published ${created.length} inspection ${created.length === 1 ? 'time' : 'times'}.`
        + (skipped > 0 ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} already listed and skipped.` : ''));
      setTimes(['']);
      onPublished();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The times could not be published. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="publish-heading" className={card}>
      <h2 id="publish-heading" className="font-heading text-h4 font-semibold text-text-dark">Publish inspection times</h2>
      <p className="mt-1 text-sm text-text-body">
        Enter each start in Sydney time (AEST or AEDT, whichever applies that day). Tenants can ask for any open time; you accept,
        decline or ask them to reschedule.
      </p>
      {/* noValidate: the database judges a time, so the browser never holds one back. */}
      <form noValidate onSubmit={(event) => void publish(event)} className="mt-4 space-y-4">
        <ul className="space-y-3">
          {times.map((time, index) => (
            <li key={index} className="flex min-w-0 flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor={`inspection-start-${index}`} className="text-sm font-semibold text-text-dark">Start {index + 1}</label>
                <input
                  id={`inspection-start-${index}`}
                  type="datetime-local"
                  value={time}
                  min={min}
                  step={TIME_STEP_SECONDS}
                  onChange={(event) => setTime(index, event.target.value)}
                  className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-sm text-text-dark"
                />
              </div>
              {times.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove start ${index + 1}`}
                  onClick={() => setTimes((previous) => previous.filter((_, at) => at !== index))}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={times.length >= MAX_TIMES}
            onClick={() => setTimes((previous) => [...previous, ''])}
          >
            Add another time
          </Button>
          <div>
            <label htmlFor="inspection-duration" className="block text-sm font-semibold text-text-dark">Length</label>
            <select
              id="inspection-duration"
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
              className="mt-1 min-h-11 rounded-lg border bg-white px-3 text-sm text-text-dark"
            >
              {DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}
            </select>
          </div>
        </div>
        {times.length >= MAX_TIMES ? <p className="text-sm text-text-body">Up to {MAX_TIMES} times at once.</p> : null}
        <Button type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish times'}</Button>
        <FormMessage error={error} success={success} />
      </form>
    </section>
  );
}
