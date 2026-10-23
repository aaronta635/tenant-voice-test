'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ConversationsView from '@/app/components/messaging/ConversationsView';
import UnscannedFilesNotice from '@/app/components/provider/UnscannedFilesNotice';
import { api, orNotFound, type Conversation, type ServiceProvider } from '@/app/lib/api';
import { BOOKING_STATUS_LABELS, formatMoney, formatSchedule } from '@/app/lib/format';
import { inboxEmptyMessage } from '@/app/lib/provider-workspace';

function BookingPanel({ active }: { active: Conversation }) {
  const booking = active.booking;

  if (!booking) {
    return (
      <aside className="rounded-[16px] border border-border bg-background p-4">
        <p className="text-sm text-text-subtle">No booking attached to this thread.</p>
      </aside>
    );
  }

  return (
    <aside className="rounded-[16px] border border-border bg-background p-4">
      <p className="text-xs font-bold tracking-wide text-text-subtle uppercase">Booking</p>
      <p className="mt-1 font-heading text-base font-bold text-text-dark">
        {booking.service_title ?? 'Service'}
      </p>
      <p className="mt-1 text-sm text-text-body">
        {BOOKING_STATUS_LABELS[booking.status] ?? booking.status}
      </p>

      <div className="mt-4 space-y-1 text-sm text-text-body">
        <p><span className="font-semibold">Scheduled: </span>{formatSchedule(booking.scheduled_date, booking.scheduled_time)}</p>
        {booking.property_address ? <p className="[overflow-wrap:anywhere]"><span className="font-semibold">Address: </span>{booking.property_address}</p> : null}
        <Link className="inline-block py-2 font-semibold text-primary-strong underline" href={`/dashboard/bookings?booking=${booking.id}`}>View booking</Link>
      </div>

      {booking.price !== null ? (
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-text-body">Job price</span>
          <span className="font-semibold text-text-dark">{formatMoney(booking.price)}</span>
        </div>
      ) : null}
    </aside>
  );
}

export default function ProviderMessagesPage() {
  // Only a published profile can be messaged from the marketplace.
  const [published, setPublished] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    orNotFound<ServiceProvider | null>(api.providers.mine(), null)
      .then((provider) => { if (active) setPublished(Boolean(provider?.is_published)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <div className="space-y-4">
      <UnscannedFilesNotice />
      <ConversationsView
        title="Messages"
        subtitle="Client conversations tied to bookings."
        emptyMessage={inboxEmptyMessage(published)}
        showFilters
        renderAside={(active) => <BookingPanel active={active} />}
      />
    </div>
  );
}
