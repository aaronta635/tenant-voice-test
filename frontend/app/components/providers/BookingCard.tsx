'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  api,
  ApiError,
  getAuthToken,
  type Availability,
  type ProviderService,
} from '@/app/lib/api';
import { formatMoney, formatServicePrice, formatTime } from '@/app/lib/format';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Props = {
  providerId: string;
  providerFirstName: string;
  services: ProviderService[];
  availability: Availability[];
  availabilityNote: string | null;
};

/** The next N calendar dates that fall on a day the provider works. */
function nextSlots(availability: Availability[], count = 6) {
  if (availability.length === 0) return [];
  const byDay = new Map<number, Availability>();
  for (const slot of availability) {
    if (slot.is_available && !byDay.has(slot.day_of_week)) byDay.set(slot.day_of_week, slot);
  }

  const slots: { value: string; label: string }[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 21 && slots.length < count; i += 1) {
    cursor.setDate(cursor.getDate() + 1);
    const slot = byDay.get(cursor.getDay());
    if (!slot) continue;
    const date = new Date(cursor);
    slots.push({
      value: `${date.toISOString().slice(0, 10)}|${slot.start_time}`,
      label: `${date.toLocaleDateString('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })} · ${formatTime(slot.start_time)}`,
    });
  }
  return slots;
}

export default function BookingCard({
  providerId,
  providerFirstName,
  services,
  availability,
  availabilityNote,
}: Props) {
  const bookable = useMemo(() => services.filter((s) => s.is_active), [services]);
  const slots = useMemo(() => nextSlots(availability), [availability]);

  const [serviceId, setServiceId] = useState(bookable[0]?.id ?? '');
  const [slot, setSlot] = useState(slots[0]?.value ?? '');
  const [suburb, setSuburb] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'booked' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [messaged, setMessaged] = useState(false);

  const service = bookable.find((s) => s.id === serviceId) ?? bookable[0];
  const signedIn = typeof window !== 'undefined' && !!getAuthToken();

  const workingDays = Array.from(
    new Set(availability.filter((a) => a.is_available).map((a) => a.day_of_week)),
  )
    .sort()
    .map((day) => DAY_NAMES[day].slice(0, 3));

  async function handleBook(event: FormEvent) {
    event.preventDefault();
    if (!service) return;
    setError(null);
    setState('submitting');
    const [date, time] = slot.split('|');
    try {
      await api.bookings.create({
        provider_id: providerId,
        service_id: service.id,
        property_suburb: suburb || null,
        scheduled_date: date || null,
        scheduled_time: time || null,
      });
      setState('booked');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that request.');
      setState('error');
    }
  }

  async function handleMessage() {
    setError(null);
    try {
      await api.conversations.startMarketplace({
        provider_id: providerId,
        subject: service?.title ?? null,
      });
      setMessaged(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open a conversation.');
    }
  }

  if (bookable.length === 0) {
    return (
      <div className="rounded-[22px] border border-[#efeff2] bg-white p-5 shadow-[0_12px_24px_rgba(14,42,72,0.1)]">
        <p className="font-bold text-[#1b1b1f]">No services listed yet</p>
        <p className="mt-2 text-sm text-[#5f6b76]">
          This provider hasn&apos;t published a fixed-price service. Message them to ask about
          availability.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleBook}
      className="rounded-[22px] border border-[#efeff2] bg-white p-5 shadow-[0_12px_24px_rgba(14,42,72,0.1)]"
    >
      <p className="text-sm text-[#8c97a2]">From</p>
      <p className="text-3xl font-extrabold text-[#1b1b1f]">
        {formatMoney(service?.price)}{' '}
        <span className="text-base font-semibold text-[#5f6b76]">
          {service?.pricing_type === 'hourly' ? 'per hour' : 'fixed'}
        </span>
      </p>
      {availabilityNote ? (
        <p className="mt-2 text-sm font-semibold text-[#1b7c4f]">● {availabilityNote}</p>
      ) : null}
      {workingDays.length > 0 ? (
        <p className="mt-1 text-xs text-[#8c97a2]">Works {workingDays.join(', ')}</p>
      ) : null}

      <label
        className="mt-5 block text-xs font-bold tracking-wide text-[#8c97a2] uppercase"
        htmlFor="booking-service"
      >
        Service
      </label>
      <select
        id="booking-service"
        value={serviceId}
        onChange={(e) => setServiceId(e.target.value)}
        className="mt-1 w-full appearance-none rounded-[12px] border border-[#efeff2] bg-white px-3 py-2.5 text-sm font-semibold text-[#1b1b1f] outline-none focus:border-primary"
      >
        {bookable.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title} · {formatServicePrice(s.price, s.pricing_type)}
          </option>
        ))}
      </select>

      {slots.length > 0 ? (
        <>
          <label
            className="mt-4 block text-xs font-bold tracking-wide text-[#8c97a2] uppercase"
            htmlFor="booking-date"
          >
            Date
          </label>
          <select
            id="booking-date"
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
            className="mt-1 w-full appearance-none rounded-[12px] border border-[#efeff2] bg-white px-3 py-2.5 text-sm font-semibold text-[#1b1b1f] outline-none focus:border-primary"
          >
            {slots.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <label
        className="mt-4 block text-xs font-bold tracking-wide text-[#8c97a2] uppercase"
        htmlFor="booking-suburb"
      >
        Property suburb
      </label>
      <input
        id="booking-suburb"
        value={suburb}
        onChange={(e) => setSuburb(e.target.value)}
        placeholder="e.g. Newtown, NSW"
        className="mt-1 w-full rounded-[12px] border border-[#efeff2] bg-white px-3 py-2.5 text-sm text-[#1b1b1f] outline-none focus:border-primary"
      />

      {error ? <p className="mt-3 text-sm font-medium text-[#b42318]">{error}</p> : null}

      {signedIn ? (
        <>
          <button
            type="submit"
            disabled={state === 'submitting' || state === 'booked'}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-bold text-white shadow-[0_4px_6px_rgba(99,106,232,0.3)] transition-colors hover:bg-[#5258d4] disabled:cursor-default disabled:bg-[#1b7c4f]"
          >
            {state === 'booked'
              ? '✓ Request sent'
              : state === 'submitting'
                ? 'Sending…'
                : 'Request to book'}
          </button>
          <button
            type="button"
            onClick={handleMessage}
            className="mt-2 flex h-12 w-full items-center justify-center rounded-full border border-[#efeff2] text-sm font-bold text-[#1b1b1f] transition-colors hover:border-primary hover:text-primary"
          >
            {messaged ? '✓ Conversation started' : `Message ${providerFirstName}`}
          </button>
        </>
      ) : (
        <Link
          href="/login"
          className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-bold text-white"
        >
          Sign in to book
        </Link>
      )}

      <p className="mt-3 text-center text-xs text-[#8c97a2]">
        {state === 'booked'
          ? `${service?.title} requested. You won’t be charged until the provider accepts.`
          : `You won’t be charged until the provider accepts. From ${formatMoney(service?.price)}.`}
      </p>
    </form>
  );
}
