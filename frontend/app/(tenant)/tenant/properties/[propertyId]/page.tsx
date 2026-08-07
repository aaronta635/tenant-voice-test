'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import TenantShell from '@/app/components/tenant/TenantShell';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import Input from '@/app/components/ui/Input';
import {
  api,
  ApiError,
  getAuthToken,
  safe,
  type Inspection,
  type Property,
  type PropertyStatus,
} from '@/app/lib/api';
import { formatDateTime } from '@/app/lib/format';

const FALLBACK_IMAGE = '/tenant/application-modern-loft.png';

const STATUS_LABEL_MAP: Record<PropertyStatus, string> = {
  available: 'Available',
  rented: 'Rented',
  off_market: 'Off market',
};

function formatAvailableDate(dateStr: string | null): string {
  if (!dateStr) return 'Contact owner';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

type ApplyState = 'idle' | 'form' | 'submitting' | 'success';

export default function PropertyDetailPage() {
  const params = useParams<{ propertyId: string }>();
  const propertyId = Array.isArray(params.propertyId) ? params.propertyId[0] : params.propertyId;

  const [property, setProperty] = useState<Property | null>(null);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setNotFound(false);
      setLoadError(null);
      try {
        const result = await api.properties.getPublic(propertyId as string);
        if (!cancelled) setProperty(result);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(err instanceof ApiError ? err.message : 'Unable to load this property right now.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  useEffect(() => {
    if (property) document.title = `${property.title} - TenantVoice`;
  }, [property]);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    safe(api.properties.inspections(propertyId as string), []).then((list) => {
      if (!cancelled) setInspections(list);
    });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  if (loading) {
    return (
      <TenantShell>
        <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
          <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center">
            <h1 className="font-heading text-xl font-semibold">Loading property…</h1>
          </Card>
        </main>
      </TenantShell>
    );
  }

  if (notFound || !property) {
    return (
      <TenantShell>
        <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
          <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center">
            <h1 className="font-heading text-xl font-semibold">Property not found</h1>
            <p className="mt-2 text-sm text-[#565d6d]">This listing may have been removed or taken off the market.</p>
            <Link href="/tenant/properties" className="mt-5 inline-block text-sm font-semibold text-primary">
              ← Back to properties
            </Link>
          </Card>
        </main>
      </TenantShell>
    );
  }

  if (loadError) {
    return (
      <TenantShell>
        <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
          <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center">
            <h1 className="font-heading text-xl font-semibold">Couldn&apos;t load this property</h1>
            <p className="mt-2 text-sm text-[#565d6d]">{loadError}</p>
            <Button variant="secondary" className="mt-5 h-10 rounded-[8px]" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </Card>
        </main>
      </TenantShell>
    );
  }

  const image = property.photo_urls?.[0] || FALLBACK_IMAGE;
  const amenities = property.amenities ?? [];
  const locationLine = [property.suburb, property.state].filter(Boolean).join(', ') || '—';

  return (
    <TenantShell>
      <main className="mx-auto grid w-full max-w-[1240px] gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <Link href="/tenant/properties" className="text-sm font-semibold text-primary">
            ← Back to properties
          </Link>
          <div className="relative mt-5 h-[420px] overflow-hidden rounded-[18px] border border-[#dee1e6] bg-[#f3f4f6]">
            <Image src={image} alt="" fill priority sizes="(min-width: 1024px) 820px, 100vw" className="object-cover" />
          </div>
          <div className="mt-6">
            <p className="text-sm font-semibold text-primary">{STATUS_LABEL_MAP[property.status]}</p>
            <h1 className="mt-1 font-heading text-4xl font-bold">{property.title}</h1>
            <p className="mt-2 text-[#565d6d]">{property.address}</p>
          </div>

          <Card className="mt-6 rounded-[16px] border border-[#dee1e6] p-6">
            <h2 className="font-heading text-xl font-semibold">Room and property details</h2>
            <p className="mt-3 text-[#565d6d]">{property.description || 'No description provided.'}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              <DetailStat label="Beds" value={property.bedrooms != null ? String(property.bedrooms) : '—'} />
              <DetailStat label="Baths" value={property.bathrooms != null ? String(property.bathrooms) : '—'} />
              <DetailStat label="Parking" value={property.parking != null ? String(property.parking) : '—'} />
              <DetailStat label="Available" value={formatAvailableDate(property.available_from)} />
            </div>
            {amenities.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {amenities.map((feature) => (
                  <span key={feature} className="rounded-full bg-[#f0f1ff] px-3 py-1 text-sm font-medium text-primary">
                    {feature}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </section>

        <aside className="space-y-5">
          <Card className="rounded-[16px] border border-[#dee1e6] p-6">
            <p className="font-heading text-4xl font-bold text-primary">${property.price}</p>
            <p className="text-sm text-[#565d6d]">per week</p>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-[#565d6d]">Bond</dt>
                <dd className="font-semibold">{property.bond != null ? `$${property.bond}` : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#565d6d]">Location</dt>
                <dd className="font-semibold">{locationLine}</dd>
              </div>
            </dl>
            <div className="mt-6 space-y-3">
              <MessageOwnerButton propertyId={property.id} title={property.title} />
              <ApplySection propertyId={property.id} />
            </div>
          </Card>
          <Card className="rounded-[16px] border border-[#dee1e6] p-6">
            <h2 className="font-heading text-lg font-semibold">Inspection times</h2>
            {inspections.length === 0 ? (
              <p className="mt-3 text-sm text-[#565d6d]">
                No inspection times published yet — message the owner to arrange one.
              </p>
            ) : (
              inspections.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  className="mt-3 block w-full rounded-[10px] border border-[#dee1e6] px-4 py-3 text-left text-sm font-medium hover:border-primary"
                >
                  {formatDateTime(slot.starts_at)}
                  {slot.notes ? <span className="block text-xs text-[#565d6d]">{slot.notes}</span> : null}
                </button>
              ))
            )}
          </Card>
        </aside>
      </main>
    </TenantShell>
  );
}

function ApplySection({ propertyId }: { propertyId: string }) {
  const [state, setState] = useState<ApplyState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [annualIncome, setAnnualIncome] = useState('');
  const [moveInDate, setMoveInDate] = useState('');
  const [rentOffered, setRentOffered] = useState('');
  const [hasPets, setHasPets] = useState(false);
  const [message, setMessage] = useState('');

  const isSignedIn = typeof window !== 'undefined' && !!getAuthToken();

  if (!isSignedIn) {
    return (
      <div className="space-y-2">
        <Link href="/login" className="block">
          <Button variant="secondary" fullWidth className="h-11 rounded-[8px]">
            Sign in to apply
          </Button>
        </Link>
        <p className="text-center text-xs text-[#565d6d]">You need a TenantVoice account to submit an application.</p>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="rounded-[10px] border border-primary/30 bg-[#f0f1ff] px-4 py-4 text-center">
        <p className="text-sm font-semibold text-primary">Application submitted</p>
        <p className="mt-1 text-xs text-[#565d6d]">The owner will review your application and reply via messages.</p>
      </div>
    );
  }

  if (state === 'idle') {
    return (
      <Button variant="secondary" fullWidth className="h-11 rounded-[8px]" onClick={() => setState('form')}>
        Apply for this property
      </Button>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setState('submitting');
    try {
      await api.applications.create({
        property_id: propertyId,
        annual_income: annualIncome ? Number(annualIncome) : null,
        move_in_date: moveInDate || null,
        rent_offered: rentOffered ? Number(rentOffered) : null,
        has_pets: hasPets,
        message: message || null,
      });
      setState('success');
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Unable to submit your application right now.');
      setState('form');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-[10px] border border-[#dee1e6] p-4">
      <Input
        label="Annual income (optional)"
        type="number"
        min="0"
        placeholder="e.g. 85000"
        value={annualIncome}
        onChange={(event) => setAnnualIncome(event.target.value)}
      />
      <Input
        label="Preferred move-in date (optional)"
        type="date"
        value={moveInDate}
        onChange={(event) => setMoveInDate(event.target.value)}
      />
      <Input
        label="Rent you're offering (optional)"
        type="number"
        min="0"
        placeholder="e.g. 720"
        value={rentOffered}
        onChange={(event) => setRentOffered(event.target.value)}
      />
      <label className="flex items-center gap-2 text-sm font-medium text-[#171a1f]">
        <input
          type="checkbox"
          checked={hasPets}
          onChange={(event) => setHasPets(event.target.checked)}
          className="size-4 accent-[#636ae8]"
        />
        I have pets
      </label>
      <div className="flex flex-col gap-[6px]">
        <label htmlFor="apply-message" className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#565d6d]">
          Message to owner (optional)
        </label>
        <textarea
          id="apply-message"
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="w-full rounded-[4px] border border-[#dee1e6] bg-[rgba(243,244,246,0.4)] px-3 py-2 text-sm text-[#171a1f] outline-none focus:border-transparent focus:ring-2 focus:ring-[#636ae8]"
          placeholder="Tell the owner a bit about yourself"
        />
      </div>

      {submitError && <p className="text-sm font-medium text-[#de3b40]">{submitError}</p>}

      <div className="flex gap-3">
        <Button
          type="button"
          variant="ghost"
          className="h-10 flex-1 rounded-[8px]"
          onClick={() => setState('idle')}
          disabled={state === 'submitting'}
        >
          Cancel
        </Button>
        <Button type="submit" className="h-10 flex-1 rounded-[8px]" disabled={state === 'submitting'}>
          {state === 'submitting' ? 'Submitting…' : 'Submit application'}
        </Button>
      </div>
    </form>
  );
}

function MessageOwnerButton({ propertyId, title }: { propertyId: string; title: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const signedIn = typeof window !== 'undefined' && !!getAuthToken();

  if (!signedIn) {
    return (
      <Link href="/login" className="block">
        <Button fullWidth className="h-11 rounded-[8px]">
          Sign in to message the owner
        </Button>
      </Link>
    );
  }

  async function start() {
    setState('sending');
    try {
      await api.conversations.startRental({
        property_id: propertyId,
        subject: title,
        body: `Hi — I'm interested in ${title}.`,
      });
      setState('sent');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <Link href="/tenant/messages" className="block">
        <Button fullWidth className="h-11 rounded-[8px]">
          Open conversation
        </Button>
      </Link>
    );
  }

  return (
    <Button fullWidth className="h-11 rounded-[8px]" onClick={start} disabled={state === 'sending'}>
      {state === 'sending' ? 'Opening…' : state === 'error' ? 'Try again' : 'Message owner'}
    </Button>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] bg-[#fafafb] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#565d6d]">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}
