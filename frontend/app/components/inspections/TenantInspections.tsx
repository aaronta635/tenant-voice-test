'use client';

// A tenant's inspections (R13): the times they asked for and where each
// stands, the homes with open times, and the inspections owners scheduled
// with them.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import InspectionRecords from '@/app/components/inspections/InspectionRecords';
import StatusPill from '@/app/components/inspections/StatusPill';
import Button from '@/app/components/ui/Button';
import { ApiError } from '@/app/lib/api';
import {
  durationLabel,
  inspectionTime,
  inspectionsApi,
  type InspectionBooking,
  type InspectionHome,
} from '@/app/lib/inspections';

const card = 'min-w-0 rounded-2xl border border-border bg-white p-5';

const NEXT_STEP: Record<string, string> = {
  pending: 'The owner will accept it, decline it or ask you to pick another time.',
  accepted: 'Accepted. This is a viewing, not a decision on a rental application.',
  rejected: 'Declined. You can ask for another open time.',
  reschedule_requested: 'The owner asked you to pick another time.',
  cancelled: 'Cancelled.',
};

type Loaded<T> = { attempt: number; items: T[] | null; error: string | null };

function useList<T>(read: () => Promise<T[]>, attempt: number): Loaded<T> | null {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  useEffect(() => {
    let active = true;
    read().then(
      (items) => { if (active) setLoaded({ attempt, items, error: null }); },
      (err) => { if (active) setLoaded({ attempt, items: null, error: err instanceof ApiError ? err.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [read, attempt]);
  return loaded?.attempt === attempt ? loaded : null;
}

export default function TenantInspections() {
  const [attempt, setAttempt] = useState(0);
  const bookings = useList<InspectionBooking>(inspectionsApi.myBookings, attempt);
  const homes = useList<InspectionHome>(inspectionsApi.homes, attempt);
  const retry = () => setAttempt((value) => value + 1);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-dark sm:text-[30px]">Inspections</h1>
        <p className="mt-1 text-sm text-text-body">Ask for a time a landlord published, and follow each request here. Times are Sydney time.</p>
      </div>

      <section aria-labelledby="my-requests-heading" className={card}>
        <h2 id="my-requests-heading" className="font-heading text-h4 font-semibold text-text-dark">My inspection requests</h2>
        {!bookings ? (
          <p role="status" className="mt-3 text-sm text-text-body">Loading your requests…</p>
        ) : bookings.error ? (
          <Failed message={bookings.error} onRetry={retry} />
        ) : !bookings.items?.length ? (
          <p className="mt-3 text-sm text-text-body">No requests yet. Pick a time on a listing to ask for an inspection.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {bookings.items.map((booking) => (
              <li key={booking.id} className="flex min-w-0 flex-col gap-1 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/tenant/properties/${booking.property_id}`} className="min-w-0 break-words font-semibold text-primary-strong underline">
                    {booking.property_title || 'Property'}
                  </Link>
                  <StatusPill kind="booking" status={booking.status} />
                </div>
                <p className="text-text-dark">{inspectionTime(booking.starts_at)} · {durationLabel(booking.duration_minutes)}</p>
                {booking.address ? <p className="break-words text-text-body">{booking.address}</p> : null}
                <p className="text-text-body">{NEXT_STEP[booking.status] ?? ''}</p>
                {booking.status === 'reschedule_requested' || booking.status === 'rejected' ? (
                  <Link href={`/tenant/properties/${booking.property_id}`} className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
                    Pick another time
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="open-homes-heading" className={card}>
        <h2 id="open-homes-heading" className="font-heading text-h4 font-semibold text-text-dark">Homes with open inspection times</h2>
        {!homes ? (
          <p role="status" className="mt-3 text-sm text-text-body">Loading homes…</p>
        ) : homes.error ? (
          <Failed message={homes.error} onRetry={retry} />
        ) : !homes.items?.length ? (
          <p className="mt-3 text-sm text-text-body">No listed home has an open inspection time right now.</p>
        ) : (
          <ul className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
            {homes.items.map((home) => (
              <li key={home.property_id} className="min-w-0 rounded-xl border border-border p-4 text-sm">
                <Link href={`/tenant/properties/${home.property_id}`} className="break-words font-semibold text-primary-strong underline">
                  {home.title || 'Property'}
                </Link>
                {home.address ? <p className="mt-1 break-words text-text-body">{home.address}</p> : null}
                <p className="mt-1 text-text-dark">
                  {home.open_slot_count} open {home.open_slot_count === 1 ? 'time' : 'times'} · {home.owner_name || 'Property owner'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <InspectionRecords mode="attendee" />
    </div>
  );
}

function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-3 space-y-3">
      <p role="alert" className="text-sm text-danger">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
    </div>
  );
}
