'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, orNotFound, type Booking, type BookingStatus, type ServiceProvider } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { BOOKING_STATUS_LABELS, formatMoney, formatSchedule, initialsOf, relativeTime } from '@/app/lib/format';
import { navigateWithinPage } from '@/app/lib/page-url';
import { verificationRequired, type VerificationRequiredDetail } from '@/app/lib/verification-gate';
import { bookingHasStarted, localDateKey, providerJobs } from '@/app/lib/provider-schedule';
import { shownCount, usePrinting, visibleRows } from '@/app/lib/provider-print';
import DemoLabel from '@/app/components/demo/DemoLabel';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FilterChip from '@/app/components/ui/FilterChip';
import Input from '@/app/components/ui/Input';
import Modal from '@/app/components/ui/Modal';
import FormMessage from '@/app/components/ui/FormMessage';
import PageHeader from '@/app/components/ui/PageHeader';
import EmptyState from '@/app/components/ui/EmptyState';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import VerificationRequired from '@/app/components/trust/VerificationRequired';

type Scope = 'dashboard' | 'owner' | 'tenant' | 'client';
const FILTERS = ['all', 'new_enquiry', 'confirmed', 'in_progress', 'completed', 'declined', 'cancelled'] as const;
const ACTIONS: Partial<Record<BookingStatus, string>> = {
  confirmed: 'Accept booking', declined: 'Decline booking', in_progress: 'Start job', completed: 'Mark done', cancelled: 'Cancel booking',
};

export default function BookingList({ scope = 'dashboard' }: { scope?: Scope }) {
  const params = useSearchParams();
  const requestedId = params.get('booking');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Booking[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [limit, setLimit] = useState(10);
  const [retained, setRetained] = useState<Set<string>>(new Set());
  const printing = usePrinting();
  useEffect(() => {
    let active = true;
    Promise.all([api.bookings.list(undefined, scope === 'client' ? 'client' : undefined), scope === 'dashboard' ? orNotFound<ServiceProvider | null>(api.providers.mine(), null) : Promise.resolve(null)])
      .then(([bookings, provider]) => { if (active) { setItems(bookings); setProviderId(provider?.id ?? null); } })
      .catch((err) => { if (active) setError(err instanceof ApiError ? err.message : 'Could not load bookings.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload, scope]);
  useEffect(() => {
    if (!loading && requestedId) document.getElementById(`booking-${requestedId}`)?.focus();
  }, [loading, requestedId]);
  // The provider's jobs only; their own requests are listed under My booking
  // requests. A linked booking still opens here, whichever side it is on.
  const jobs = useMemo(() => scope === 'dashboard' ? providerJobs(items, providerId) : items, [items, providerId, scope]);
  const filtered = useMemo(() => (requestedId ? items : jobs).filter((item) => {
    if (requestedId && item.id !== requestedId) return false;
    if (filter !== 'all' && item.status !== filter && !retained.has(item.id)) return false;
    const text = [item.client_name, item.provider_name, item.service_title, item.property_suburb, item.property_address].join(' ').toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }), [items, jobs, filter, retained, query, requestedId]);
  // A printout lists every booking in the view, not just those revealed so far.
  const shown = visibleRows(filtered, limit, printing);
  function changed(booking: Booking) {
    setRetained((prev) => new Set([...prev, booking.id]));
    setItems((prev) => prev.map((item) => item.id === booking.id ? booking : item));
    window.dispatchEvent(new Event('tenantvoice:counts-changed'));
  }
  const allBookingsHref = scope === 'client' ? '/dashboard/client-bookings' : `/${scope}/bookings`;
  return <div className="space-y-6">
    <PageHeader title={scope === 'dashboard' ? 'Bookings' : scope === 'client' ? 'My booking requests' : 'Service bookings'} description="Track requests and scheduled services. All appointment times are in Sydney time." />
    <div className="print:hidden"><Input type="search" label="Search bookings" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(10); setRetained(new Set()); }} className="max-w-lg" /></div>
    <p className="hidden print:block">Status: {filter === 'all' ? 'All' : BOOKING_STATUS_LABELS[filter]}{query ? ` · Search: ${query}` : ''}</p>
    <div role="group" aria-label="Booking status" className="flex gap-2 overflow-x-auto pb-2 print:hidden">
      {FILTERS.map((value) => <FilterChip key={value} selected={filter === value}
        onClick={() => { setFilter(value); setLimit(10); setRetained(new Set()); }}>
        {value === 'all' ? 'All' : BOOKING_STATUS_LABELS[value]}{!loading && !error ? ` (${jobs.filter((item) => value === 'all' || item.status === value).length})` : ''}
      </FilterChip>)}
    </div>
    {requestedId && <Link className="inline-block text-primary-strong underline" href={allBookingsHref} onNavigate={navigateWithinPage(allBookingsHref)}>View all bookings</Link>}
    {loading ? <p role="status">Loading bookings…</p> : error ? <LoadErrorCard message={error} onRetry={() => { setError(null); setLoading(true); setReload((n) => n + 1); }} /> : <>
      {scope === 'dashboard' && !providerId && <EmptyState title="Set up your provider profile" description="Complete setup to receive service requests." action={<Link href="/dashboard/onboarding" className="text-primary-strong underline">Start onboarding</Link>} />}
      {filtered.length === 0 ? <EmptyState title={requestedId ? 'Booking not found' : 'No bookings in this view'} description="Try another status or clear your search." /> :
        shown.map((item) => <BookingItem key={item.id} booking={item} scope={scope} isProvider={providerId === item.provider_id} onChange={changed} />)}
      {filtered.length > limit && <Button variant="secondary" onClick={() => setLimit((n) => n + 10)}>Show more bookings ({filtered.length - limit} remaining)</Button>}
      {!requestedId && filtered.length > 0 ? <p role="status" className="text-sm text-text-body">{shownCount(shown.length, filtered.length, 'booking')}</p> : null}
    </>}
  </div>;
}

function BookingItem({ booking, scope, isProvider, onChange }: { booking: Booking; scope: Scope; isProvider: boolean; onChange: (item: Booking) => void }) {
  const router = useRouter();
  const [openingMessage, setOpeningMessage] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const openingMessageRef = useRef(false);
  const createdThreadRef = useRef<string | null>(null);
  const messagesHref = `/${scope === 'client' ? 'dashboard' : scope}/messages`;
  const [action, setAction] = useState<BookingStatus | 'reschedule' | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Accepting and starting a job need a verified provider (R18): the server's refusal.
  const [gate, setGate] = useState<VerificationRequiredDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [date, setDate] = useState(booking.scheduled_date ?? '');
  const [time, setTime] = useState(booking.scheduled_time?.slice(0, 5) ?? '');
  const [agreed, setAgreed] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setClock(new Date());
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Move focus to the result, unless the person has moved on while it saved,
  // say to a dialog opened on top of this one.
  useEffect(() => { if (notice) focusResult(resultRef.current, document.getElementById(`booking-${booking.id}`)); }, [notice, booking.id]);
  const person = (isProvider ? booking.client_name : booking.provider_name) ?? (isProvider ? 'Client' : 'Service provider');
  const canReschedule = isProvider && ['new_enquiry', 'confirmed'].includes(booking.status);
  const ready = bookingHasStarted(booking, clock);
  const actions: BookingStatus[] = isProvider
    ? booking.status === 'new_enquiry' ? ['confirmed', 'declined'] : booking.status === 'confirmed' ? ['in_progress'] : booking.status === 'in_progress' ? ['completed'] : []
    : ['new_enquiry', 'confirmed'].includes(booking.status) ? ['cancelled'] : [];
  const sameTime = date === (booking.scheduled_date ?? '') && time === (booking.scheduled_time?.slice(0, 5) ?? '');
  const rescheduleInPast = !!date && !!time && bookingHasStarted({ scheduled_date: date, scheduled_time: time }, clock);
  function open(next: typeof action) { setError(null); setGate(null); setAgreed(false); setDate(booking.scheduled_date ?? ''); setTime(booking.scheduled_time?.slice(0, 5) ?? ''); setAction(next); }
  async function openMessage() {
    if (openingMessageRef.current || busyRef.current) return;
    openingMessageRef.current = true;
    setOpeningMessage(true);
    setMessageError(null);
    try {
      let threadId = booking.conversation_id ?? createdThreadRef.current;
      if (!threadId) {
        const thread = await api.conversations.startMarketplace({
          provider_id: booking.provider_id,
          booking_id: booking.id,
          ...(isProvider ? { client_id: booking.client_id } : {}),
          subject: booking.service_title ?? 'Service booking',
        });
        threadId = thread.id;
        createdThreadRef.current = threadId;
        onChange({ ...booking, conversation_id: threadId });
      }
      router.push(`${messagesHref}?thread=${encodeURIComponent(threadId)}`);
    } catch (err) {
      setMessageError(err instanceof ApiError ? err.message : 'Could not open this booking conversation. Please try again.');
    } finally { openingMessageRef.current = false; setOpeningMessage(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || busyRef.current) return;
    if (action === 'reschedule' && (!date || !time || !agreed || sameTime || rescheduleInPast)) return;
    if (['in_progress', 'completed'].includes(action) && !bookingHasStarted(booking)) return;
    busyRef.current = true; setBusy(true); setError(null); setGate(null);
    try {
      const updated = await api.bookings.update(booking.id, action === 'reschedule' ? { scheduled_date: date, scheduled_time: time } : { status: action });
      onChange(updated);
      setAction(null);
      setNotice(action === 'reschedule' ? `Rescheduled for ${formatSchedule(updated.scheduled_date, updated.scheduled_time)}.` : `Booking updated: ${BOOKING_STATUS_LABELS[updated.status]}.`);
      setCooldown(true);
      timer.current = setTimeout(() => setCooldown(false), 1000);
    } catch (err) {
      const refusal = verificationRequired(err);
      if (refusal) setGate(refusal);
      else setError(err instanceof ApiError ? err.message : 'Could not update this booking. Please try again.');
    }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <Card id={`booking-${booking.id}`} tabIndex={-1} className="p-5 print:break-inside-avoid">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="flex min-w-0 gap-3">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface font-bold text-navy">{initialsOf(person)}</span>
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-heading text-h4 font-semibold">{person}</h2><span className="rounded-full border border-control-border px-2 py-1 text-xs font-semibold">{BOOKING_STATUS_LABELS[booking.status]}</span></div>
          <p className="mt-1 font-medium">{booking.service_title ?? 'Service booking'}</p>
          <dl className="mt-3 grid gap-2 text-sm text-text-body">
            <div><dt className="inline font-semibold">Appointment: </dt><dd className="inline">{formatSchedule(booking.scheduled_date, booking.scheduled_time)}</dd></div>
            <div><dt className="inline font-semibold">Location: </dt><dd className="inline">{booking.property_address || booking.property_suburb || 'Arrange location with the client'}</dd></div>
            <div><dt className="inline font-semibold">Price: </dt><dd className="inline">{formatMoney(booking.price)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-text-body">Requested {relativeTime(booking.created_at)}</p>
          {booking.notes && <p className="mt-3 text-sm">{booking.notes}</p>}
          {booking.completion_report && <p className="mt-3 rounded-lg bg-surface p-3 text-sm">{booking.completion_report}</p>}
          {booking.review_rating ? <p className="mt-3 text-sm">Review: {booking.review_rating.toFixed(1)} out of 5</p> : null}
        </div>
      </div>
      <div className="flex min-h-12 flex-wrap items-center gap-2 print:hidden">
        <div ref={resultRef} tabIndex={-1} className={notice ? 'w-full' : ''}><FormMessage success={notice} /></div>
        {notice ? <Button variant="secondary" disabled={cooldown} onClick={() => setNotice(null)}>View booking actions</Button> : <>
          {booking.conversation_id ? <Link className="inline-flex min-h-11 items-center rounded-lg border border-control-border px-3 text-sm" aria-label={`Message ${person} about ${booking.service_title ?? 'booking'}`} href={`${messagesHref}?thread=${encodeURIComponent(booking.conversation_id)}`}>Message</Link> : <Button variant="secondary" disabled={openingMessage || busy} aria-label={`Message ${person} about ${booking.service_title ?? 'booking'}`} onClick={() => void openMessage()}>{openingMessage ? 'Opening conversation…' : 'Message'}</Button>}
          <p className="sr-only" role="status">{openingMessage ? 'Opening booking conversation…' : ''}</p>
          {canReschedule && <Button variant="secondary" disabled={openingMessage} aria-label={`Reschedule booking with ${person}`} onClick={() => open('reschedule')}>Reschedule</Button>}
          {actions.map((status) => <Button key={status} variant={['declined', 'cancelled'].includes(status) ? 'secondary' : 'primary'}
            disabled={openingMessage || (['in_progress', 'completed'].includes(status) && !ready)}
            aria-label={`${ACTIONS[status]} for ${person}`} onClick={() => open(status)}>{ACTIONS[status]}</Button>)}
          {actions.some((status) => ['in_progress', 'completed'].includes(status)) && !ready && <p className="w-full text-xs text-text-body">Available from the scheduled appointment time.</p>}
        </>}
      </div>
    </div>
    <FormMessage error={messageError} />
    <Modal open={action !== null} title={action === 'reschedule' ? 'Reschedule booking' : `${action ? ACTIONS[action] : ''}?`} busy={busy} onClose={() => setAction(null)}>
      <form onSubmit={submit} className="space-y-4">
        <p>{person} · {booking.service_title ?? 'Service booking'}<br />{formatSchedule(booking.scheduled_date, booking.scheduled_time)}</p>
        {action === 'reschedule' ? <>
          <Input type="date" label="New date" min={localDateKey()} required value={date} onChange={(e) => setDate(e.target.value)} />
          <Input type="time" label="New time (Sydney)" required value={time} onChange={(e) => setTime(e.target.value)} />
          <p className="text-sm text-text-body">This changes the booking immediately and sends the client an update. Message the client first to agree on the new time.</p>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 size-5 shrink-0" />The client has agreed to this new time.</label>
          {sameTime && <p className="text-sm text-text-body">Choose a different date or time.</p>}
          {rescheduleInPast && <p className="text-sm text-danger">Choose a future appointment time.</p>}
        </> : <p className="text-sm text-text-body">{action === 'completed' ? 'Confirm the work is finished.' : action === 'declined' || action === 'cancelled' ? 'This closes the booking and cannot be undone here.' : 'Confirm this change to the booking. The client will receive an update.'}</p>}
        {action === 'completed' ? <DemoLabel variant="notice" reason="Completing records a payment and the platform fee in the simulated ledger. No money is taken or paid out." /> : null}
        {gate ? <VerificationRequired detail={gate} /> : null}
        <FormMessage error={error} />
        <div className="flex flex-wrap gap-3"><Button type="button" variant="secondary" disabled={busy} onClick={() => setAction(null)}>Go back</Button><Button type="submit" disabled={busy || (action === 'reschedule' && (!date || !time || !agreed || sameTime || rescheduleInPast))}>{busy ? 'Saving…' : action === 'reschedule' ? 'Confirm reschedule' : 'Confirm change'}</Button></div>
      </form>
    </Modal>
  </Card>;
}
