'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  api,
  ApiError,
  safe,
  type Booking,
  type BookingStatus,
  type ServiceProvider,
} from '@/app/lib/api';
import {
  BOOKING_STATUS_LABELS,
  formatMoney,
  formatSchedule,
  initialsOf,
  relativeTime,
} from '@/app/lib/format';

const TABS: { id: 'all' | BookingStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'new_enquiry', label: 'New enquiries' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export default function BookingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Booking[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [bookings, provider] = await Promise.all([
        safe(api.bookings.list(), []),
        safe<ServiceProvider | null>(api.providers.mine(), null),
      ]);
      if (!active) return;
      setItems(bookings);
      setProviderId(provider?.id ?? null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    const base: Record<string, number> = { all: items.length };
    for (const b of items) base[b.status] = (base[b.status] ?? 0) + 1;
    return base;
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((b) => {
      if (tab !== 'all' && b.status !== tab) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return [b.client_name, b.service_title, b.property_suburb, b.property_address]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(q));
    });
  }, [items, tab, query]);

  async function updateStatus(id: string, status: BookingStatus) {
    setBusyId(id);
    setError(null);
    try {
      const updated = await api.bookings.update(id, { status });
      setItems((prev) => prev.map((b) => (b.id === id ? updated : b)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that booking.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-[#1b1b1f]">Bookings</h1>
          <p className="mt-1 text-[#5f6b76]">
            Manage enquiries, accept bookings, track active jobs.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bookings"
          className="h-11 w-full max-w-sm rounded-[12px] border border-[#efeff2] bg-white px-4 text-sm outline-none focus:border-primary lg:w-72"
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-[#efeff2] pb-3">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                active
                  ? 'bg-[#0e2a48] text-white'
                  : 'bg-white text-[#5f6b76] ring-1 ring-[#efeff2] hover:text-[#1b1b1f]'
              }`}
            >
              {t.label}
              <span className="ml-1.5 opacity-80">({counts[t.id] ?? 0})</span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="mt-4 rounded-[12px] border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        {loading ? (
          <p className="text-[#5f6b76]">Loading bookings…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[#c5cad3] bg-white p-10 text-center text-[#5f6b76]">
            No bookings in this view.
          </div>
        ) : (
          filtered.map((booking) => (
            <BookingRow
              key={booking.id}
              booking={booking}
              isProvider={providerId === booking.provider_id}
              busy={busyId === booking.id}
              onUpdate={updateStatus}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BookingRow({
  booking,
  isProvider,
  busy,
  onUpdate,
}: {
  booking: Booking;
  isProvider: boolean;
  busy: boolean;
  onUpdate: (id: string, status: BookingStatus) => void;
}) {
  const meta = [
    formatSchedule(booking.scheduled_date, booking.scheduled_time),
    booking.property_address ? `📍 ${booking.property_address}` : null,
    booking.price !== null ? `💵 ${formatMoney(booking.price)} fixed` : null,
    `Submitted ${relativeTime(booking.created_at)}`,
  ].filter(Boolean);

  return (
    <article className="rounded-[20px] border border-[#efeff2] bg-white p-5 shadow-[0_1px_1px_rgba(14,42,72,0.04)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-[#eeeffd] text-sm font-bold text-[#0e2a48]">
            {initialsOf(booking.client_name)}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-[#1b1b1f]">
                {booking.client_name ?? 'Client'}
              </h2>
              <StatusBadge status={booking.status} />
              {booking.unread_count > 0 ? (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-white">
                  {booking.unread_count} new
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-[#5f6b76]">
              {[booking.service_title, booking.property_suburb].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-2 text-sm text-[#5f6b76]">📅 {meta.join(' · ')}</p>
            {booking.notes ? (
              <p className="mt-2 text-sm text-[#8c97a2] italic">&ldquo;{booking.notes}&rdquo;</p>
            ) : null}
            {booking.completion_report ? (
              <p className="mt-2 rounded-[10px] bg-[#f4f4f8] px-3 py-2 text-sm text-[#5f6b76]">
                {booking.completion_report}
              </p>
            ) : null}
            {booking.review_rating ? (
              <p className="mt-2 text-sm font-semibold text-[#0e2a48]">
                ★ {booking.review_rating.toFixed(1)} review received
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Link
            href="/dashboard/messages"
            className="inline-flex h-9 items-center rounded-full border border-[#efeff2] px-3 text-sm font-semibold text-[#1b1b1f]"
          >
            Message
          </Link>
          {isProvider && booking.status === 'new_enquiry' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onUpdate(booking.id, 'declined')}
                className="inline-flex h-9 items-center rounded-full border border-[#efeff2] px-3 text-sm font-semibold text-[#5f6b76] disabled:opacity-50"
              >
                Decline
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onUpdate(booking.id, 'confirmed')}
                className="inline-flex h-9 items-center rounded-full bg-primary px-3 text-sm font-bold text-white disabled:opacity-50"
              >
                Accept booking
              </button>
            </>
          ) : null}
          {isProvider && booking.status === 'confirmed' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdate(booking.id, 'in_progress')}
              className="inline-flex h-9 items-center rounded-full bg-primary px-3 text-sm font-bold text-white disabled:opacity-50"
            >
              Start job
            </button>
          ) : null}
          {isProvider && booking.status === 'in_progress' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdate(booking.id, 'completed')}
              className="inline-flex h-9 items-center rounded-full bg-[#0e2a48] px-3 text-sm font-bold text-white disabled:opacity-50"
            >
              Mark done
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: BookingStatus }) {
  const map: Record<BookingStatus, string> = {
    new_enquiry: 'bg-[#eeeffd] text-primary',
    confirmed: 'bg-[#fff4e5] text-[#b86e00]',
    in_progress: 'bg-[#e6f4ed] text-[#1b7c4f]',
    completed: 'bg-[#f4f4f8] text-[#5f6b76]',
    declined: 'bg-[#fde8e8] text-[#b42318]',
    cancelled: 'bg-[#fde8e8] text-[#b42318]',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${map[status]}`}>
      {BOOKING_STATUS_LABELS[status] ?? status}
    </span>
  );
}
