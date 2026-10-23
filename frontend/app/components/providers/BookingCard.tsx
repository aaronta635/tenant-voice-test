'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import FormMessage from '@/app/components/ui/FormMessage';
import { api, ApiError, getAuthToken, type Availability, type ProviderService } from '@/app/lib/api';
import { formatServicePrice } from '@/app/lib/format';
import { nextBookableSlots, type BusyTime } from '@/app/lib/booking-slots';
import { useClientReady } from '@/app/lib/use-client-ready';
import { getClientSessionRole, messagesHrefForRole } from '@/app/lib/session-role';
import { bookingSignInHref } from '@/app/lib/provider-view';
import { safeNextPath } from '@/app/lib/auth-redirect';

type Props = { providerId: string; providerFirstName: string; services: ProviderService[]; availability: Availability[]; availabilityNote: string | null; requestedService?: { id: string }; listingHref?: string };
const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-control-border bg-white px-3 py-2 text-sm text-text-dark';

export default function BookingCard({ providerId, providerFirstName, services, availability, availabilityNote, requestedService, listingHref }: Props) {
  const bookable = useMemo(() => services.filter((service) => service.is_active), [services]);
  const clientReady = useClientReady();
  const id = useId();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [serviceId, setServiceId] = useState(requestedService?.id ?? params.get('service') ?? bookable[0]?.id ?? '');
  const [slot, setSlot] = useState(params.get('slot') ?? '');
  const [suburb, setSuburb] = useState(params.get('suburb')?.slice(0,120) ?? '');
  const [busy, setBusy] = useState<BusyTime[] | null>(null);
  const [busyError, setBusyError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<'suburb' | 'date' | null>(null);
  const [submitted, setSubmitted] = useState<{ title: string; label: string; suburb: string } | null>(null);
  // "Book this service" on the profile sends a new request object. Applying it
  // here instead of remounting keeps the visitor's time and suburb.
  const [appliedRequest, setAppliedRequest] = useState(requestedService);
  if (requestedService !== appliedRequest) {
    setAppliedRequest(requestedService);
    if (requestedService && submitted) { startAnotherRequest(); setServiceId(requestedService.id); }
    else if (requestedService) changeService(requestedService.id);
  }
  const inFlight = useRef(false);
  const successRef = useRef<HTMLDivElement>(null);
  const service = bookable.find((item) => item.id === serviceId) ?? bookable[0];
  const slots = useMemo(() => clientReady && busy ? nextBookableSlots(availability, service?.duration_minutes ?? 60, busy) : [], [availability, busy, clientReady, service?.duration_minutes]);
  const validSlot = slots.some((item) => item.value === slot);
  const signedIn = clientReady && !!getAuthToken();
  const role = clientReady ? getClientSessionRole() : null;
  const bookingsHref = role === 'Owner' ? '/owner/bookings' : role === 'Provider' ? '/dashboard/client-bookings' : '/tenant/bookings';
  // Login refuses the whole return path when one part makes safeNextPath fail,
  // such as a suburb typed as "100% Newtown" or "Newtown\NSW", so each part goes
  // in only if the path bookingSignInHref builds still passes with it. The
  // visitor's filtered listing is the one the page validated, never the raw ?from=.
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ service: service?.id, slot, suburb, from: listingHref })) {
    if (!value) continue;
    next.set(key, value);
    if (!safeNextPath(`${pathname}?${next}#booking`)) next.delete(key);
  }
  const loginHref = bookingSignInHref(pathname, next);

  useEffect(() => {
    let cancelled = false;
    api.providers.busyTimes(providerId).then((items) => { if (!cancelled) { setBusy(items); setBusyError(null); } }).catch(() => { if (!cancelled) setBusyError('Could not check available times. Please try again.'); });
    return () => { cancelled = true; };
  }, [providerId,retry]);
  useEffect(() => { if (submitted) successRef.current?.focus(); }, [submitted]);

  function changeService(nextId: string) {
    const nextService = bookable.find((item) => item.id === nextId);
    // Before the busy times load, keep the time: the date field checks it once they arrive.
    if (busy && slot && !nextBookableSlots(availability,nextService?.duration_minutes ?? 60,busy).some((item) => item.value === slot)) {
      setSlot(''); setNotice('The previous time does not fit this service. Please choose a new time.');
    } else setNotice(null);
    setServiceId(nextId); setError(null); setInvalidField(null);
  }
  function startAnotherRequest() {
    setSubmitted(null); setSlot(''); setError(null); setNotice(null); setBusy(null); setRetry((value) => value + 1);
  }
  async function handleBook(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !service || submitted || !busy || busyError) return;
    setError(null); setInvalidField(null);
    if (!suburb.trim()) { setInvalidField('suburb'); setError('Enter the property suburb.'); document.getElementById(`${id}-suburb`)?.focus(); return; }
    if (!validSlot) { setInvalidField('date'); setError('Choose an available date and time.'); document.getElementById(`${id}-date`)?.focus(); return; }
    inFlight.current = true; setSubmitting(true);
    const [date,time] = slot.split('|');
    try {
      await api.bookings.create({ provider_id: providerId, service_id: service.id, property_suburb: suburb.trim(), scheduled_date: date, scheduled_time: time });
      setSubmitted({ title:service.title, label:slots.find((item) => item.value === slot)!.label, suburb:suburb.trim() });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that request.');
      // Refresh occupied intervals after a race with another client; never choose a replacement silently.
      setBusy(null);
      setRetry((value) => value + 1);
    } finally { inFlight.current = false; setSubmitting(false); }
  }
  async function handleMessage() {
    if (messaging) return;
    if (!signedIn) { router.push(loginHref); return; }
    setMessaging(true); setError(null);
    try {
      const thread = await api.conversations.startMarketplace({ provider_id: providerId, subject:service?.title ?? null });
      router.push(`${messagesHrefForRole(role)}?thread=${thread.id}`);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not open a conversation.'); }
    finally { setMessaging(false); }
  }
  if (submitted) return <div ref={successRef} tabIndex={-1} className="rounded-2xl border border-success bg-white p-5">
    <h2 className="font-heading text-xl font-bold">Request sent</h2><p role="status" className="mt-3 text-sm text-text-body">{submitted.title} requested for {submitted.label} (Sydney time), {submitted.suburb}. The provider will review your request.</p>
    <Link className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary-strong underline" href={bookingsHref}>View your bookings</Link>
    <button type="button" className="mt-2 block min-h-11 text-sm font-semibold text-text-body underline" onClick={startAnotherRequest}>Book another service</button>
  </div>;
  if (!service) return <section className="rounded-2xl border border-border bg-white p-5"><h2 className="font-bold">No services listed yet</h2><p className="mt-2 text-sm text-text-body">Message this provider to ask about their services.</p><button type="button" onClick={handleMessage} disabled={messaging} className="mt-3 min-h-11 font-semibold text-primary-strong underline">{messaging ? 'Opening…' : `Message ${providerFirstName}`}</button><FormMessage error={error} /></section>;

  return <form onSubmit={handleBook} className="rounded-2xl border border-border bg-white p-5 print:hidden" aria-busy={submitting}>
    <h2 className="font-heading text-xl font-bold">Request a booking</h2><p className="mt-2 text-2xl font-bold">{formatServicePrice(service.price,service.pricing_type)}</p>
    {availabilityNote ? <p className="mt-2 text-sm text-text-body">{availabilityNote}</p> : null}
    <fieldset disabled={submitting}>
      <label className="mt-4 block text-sm font-semibold" htmlFor={`${id}-service`}>Service</label><select id={`${id}-service`} className={inputClass} value={service.id} onChange={(event) => changeService(event.target.value)}>{bookable.map((item) => <option key={item.id} value={item.id}>{item.title} · {formatServicePrice(item.price,item.pricing_type)}</option>)}</select>
      <label className="mt-4 block text-sm font-semibold" htmlFor={`${id}-date`}>Date and time (Sydney)</label><select id={`${id}-date`} className={inputClass} value={validSlot ? slot : ''} onChange={(event) => { setSlot(event.target.value); setNotice(null); setError(null); }} required disabled={!busy || !!busyError || slots.length === 0} aria-invalid={invalidField === 'date' || undefined} aria-describedby={invalidField === 'date' ? `${id}-error` : undefined}><option value="">Choose a time</option>{slots.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      {busyError ? <div role="alert" className="mt-2 text-sm text-danger">{busyError} <button type="button" onClick={() => { setBusyError(null); setBusy(null); setRetry((value) => value+1); }} className="min-h-11 font-semibold underline">Try again</button></div> : !busy ? <p role="status" className="mt-2 text-sm text-text-body">Checking available times…</p> : slots.length === 0 ? <p className="mt-2 text-sm text-text-body">No available times in the next two weeks. Message the provider to arrange a time.</p> : null}
      {slot && !validSlot && busy ? <p role="status" className="mt-2 text-sm text-text-body">Your previously selected time is unavailable. Choose another time.</p> : null}
      <label className="mt-4 block text-sm font-semibold" htmlFor={`${id}-suburb`}>Property suburb (required)</label><input id={`${id}-suburb`} className={inputClass} value={suburb} onChange={(event) => setSuburb(event.target.value)} required maxLength={120} autoComplete="address-level2" placeholder="e.g. Newtown, NSW" aria-invalid={invalidField === 'suburb' || undefined} aria-describedby={invalidField === 'suburb' ? `${id}-error` : undefined} />
    </fieldset>
    <div id={`${id}-error`}><FormMessage error={error} success={notice} /></div>
    {signedIn ? <button type="submit" disabled={submitting || !busy || !!busyError || slots.length === 0} className="mt-4 min-h-12 w-full rounded-full border border-transparent bg-primary-strong px-3 text-sm font-bold text-white disabled:opacity-60">{submitting ? 'Sending…' : 'Request to book'}</button> : <Link href={loginHref} className="mt-4 flex min-h-12 items-center justify-center rounded-full border border-transparent bg-primary-strong text-sm font-bold text-white">Sign in to book</Link>}
    <button type="button" onClick={handleMessage} disabled={messaging || submitting} className="mt-2 min-h-12 w-full rounded-full border border-control-border px-3 text-sm font-semibold">{messaging ? 'Opening…' : `Message ${providerFirstName}`}</button><p className="mt-3 text-center text-xs text-text-body">This sends a request for the provider to accept. No charge is made by this form.</p>
  </form>;
}
