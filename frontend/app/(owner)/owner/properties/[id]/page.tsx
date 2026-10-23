'use client';

import { Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import InspectionRecords from '@/app/components/inspections/InspectionRecords';
import OwnerInspectionTimes from '@/app/components/inspections/OwnerInspectionTimes';
import ListingStatusActions from '@/app/components/rental/ListingStatusActions';
import PropertyApplications from '@/app/components/rental/PropertyApplications';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import { api, ApiError, type Application, type Property } from '@/app/lib/api';
import { formatDate, formatMoney } from '@/app/lib/format';
import {
  LISTING_STATUS_LABELS,
  LISTING_STATUS_STYLES,
  PROPERTY_TYPE_LABELS,
  isPublicStatus,
  listingStatusOf,
  stageOf,
} from '@/app/lib/listings';
import { setSearchParams } from '@/app/lib/page-url';
import { isRemoteImage } from '@/app/lib/remote-image';

// "Details", "Applications" and "Inspections" are in-screen tabs (docs/navigation-flow.md);
// ?tab=applications opens the second, as a new application's notice does, and
// ?tab=inspections the third, as the listing page's "Manage inspection times" does.
type TabId = 'details' | 'applications' | 'inspections';
const TABS: { id: TabId; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'applications', label: 'Applications' },
  { id: 'inspections', label: 'Inspections' },
];
const tabOf = (value: string | null): TabId => TABS.find((item) => item.id === value)?.id ?? 'details';

export default function PropertyDetailsPage() {
  return (
    <Suspense fallback={<p role="status" className="text-text-body">Loading property…</p>}>
      <OwnerListing />
    </Suspense>
  );
}

function OwnerListing() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const tab = tabOf(useSearchParams().get('tab'));
  // Each read is kept with the listing id it was for.
  const [loaded, setLoaded] = useState<{ id: string; property: Property } | null>(null);
  const [failure, setFailure] = useState<{ id: string; notFound: boolean; message: string } | null>(null);
  const [applications, setApplications] = useState<{ id: string; list: Application[] } | null>(null);
  const [applicationsError, setApplicationsError] = useState<{ id: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [applicationsAttempt, setApplicationsAttempt] = useState(0);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ details: null, applications: null, inspections: null });

  useEffect(() => {
    let active = true;
    api.properties.getMine(id).then(
      (property) => {
        if (!active) return;
        setLoaded({ id, property });
        setFailure(null);
      },
      (err) => {
        if (!active) return;
        setFailure({
          id,
          notFound: err instanceof ApiError && err.status === 404,
          message: err instanceof ApiError ? err.message : 'Could not load this property. Please try again.',
        });
      },
    );
    return () => {
      active = false;
    };
  }, [id, attempt]);

  useEffect(() => {
    let active = true;
    api.applications.listForProperty(id).then(
      (list) => {
        if (!active) return;
        setApplications({ id, list });
        setApplicationsError(null);
      },
      (err) => {
        if (active) setApplicationsError({ id, message: err instanceof ApiError ? err.message : 'Could not load the applications.' });
      },
    );
    return () => {
      active = false;
    };
  }, [id, applicationsAttempt]);

  const property = loaded && loaded.id === id ? loaded.property : null;
  const failed = failure && failure.id === id ? failure : null;
  const list = applications && applications.id === id ? applications.list : null;
  const listError = applicationsError && applicationsError.id === id ? applicationsError.message : null;

  if (failed) {
    return (
      <div className="flex max-w-xl flex-col gap-4 rounded-2xl border border-border bg-white p-6">
        <h1 className="font-heading text-h3 font-semibold text-text-dark">{failed.notFound ? 'Property not found' : "Couldn't load this property"}</h1>
        <p className="text-sm text-text-body">
          {failed.notFound ? 'It may have been deleted, or it belongs to another landlord.' : failed.message}
        </p>
        <div className="flex flex-wrap gap-3">
          {failed.notFound ? null : (
            <Button variant="secondary" onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}>Try again</Button>
          )}
          <ButtonLink href="/owner/properties" variant="ghost">← Back to properties</ButtonLink>
        </div>
      </div>
    );
  }
  if (!property) return <p role="status" className="text-text-body">Loading property…</p>;

  const status = listingStatusOf(property);
  const photos = property.photo_urls ?? [];
  const newCount = (list ?? []).filter((application) => application.status === 'new').length;

  function showTab(next: TabId) {
    setSearchParams({ tab: next === 'details' ? null : next });
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const at = TABS.findIndex((item) => item.id === tab);
    const next = TABS[(at + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    showTab(next);
    tabRefs.current[next]?.focus();
  }

  function replaceApplication(updated: Application) {
    setApplications((current) => current && {
      id: current.id,
      list: current.list.map((application) => (application.id === updated.id ? updated : application)),
    });
    if (stageOf(updated) === 'approved') {
      // Approving leased the listing and declined the other open applications: read both again.
      setAttempt((value) => value + 1);
      setApplicationsAttempt((value) => value + 1);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Link href="/owner/properties" className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-primary-strong underline">
        ← Properties
      </Link>

      <section aria-labelledby="listing-title" className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {photos[0] ? (
          <div className="relative h-64 overflow-hidden rounded-2xl sm:h-72">
            <Image src={photos[0]} alt="" fill priority sizes="(min-width: 1024px) 560px, 100vw" className="object-cover" unoptimized={isRemoteImage(photos[0])} />
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center rounded-2xl bg-surface text-sm text-text-body sm:h-72">No photo yet</div>
        )}
        <div className="flex min-w-0 flex-col gap-3">
          <span className={`inline-flex items-center self-start rounded-full border px-3 py-1 text-xs font-semibold ${LISTING_STATUS_STYLES[status]}`}>
            {LISTING_STATUS_LABELS[status]}
          </span>
          <h1 id="listing-title" className="break-words font-heading text-h2 font-bold text-text-dark">{property.title}</h1>
          <p className="break-words text-text-body">{property.address}</p>
          <p className="text-xl font-bold text-text-dark">{formatMoney(property.price)}<span className="text-sm font-normal text-text-body"> a week</span></p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/owner/properties/${property.id}/edit`} size="sm" variant="secondary">Edit listing</ButtonLink>
            {isPublicStatus(status) ? (
              <ButtonLink href={`/properties/${property.id}`} size="sm" variant="ghost">View public page</ButtonLink>
            ) : null}
          </div>
          <ListingStatusActions
            property={property}
            onChanged={(updated) => setLoaded({ id, property: updated })}
            onArchived={() => router.push('/owner/properties')}
          />
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Applications" value={list ? String(list.filter((application) => !['withdrawn', 'expired'].includes(application.stage ?? '')).length) : '…'} />
        <Stat label="New" value={list ? String(newCount) : '…'} />
        <Stat label="Rating" value={property.review_count ? property.rating_avg.toFixed(1) : 'No ratings yet'} />
        <Stat label="Reviews" value={String(property.review_count)} />
      </dl>

      <div className="flex min-w-0 flex-wrap items-end gap-1 border-b border-border">
        <div role="tablist" aria-label="Listing" className="flex flex-wrap gap-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              ref={(element) => { tabRefs.current[item.id] = element; }}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => showTab(item.id)}
              onKeyDown={onTabKey}
              className={`min-h-11 px-4 text-sm font-semibold ${tab === item.id ? 'border-b-2 border-primary-strong text-primary-strong' : 'text-text-body hover:text-text-dark'}`}
            >
              {item.label}
              {item.id === 'applications' && list ? ` (${list.length})` : ''}
            </button>
          ))}
        </div>
        <Link href={`/owner/properties/${property.id}/analytics`} className="inline-flex min-h-11 items-center px-4 text-sm font-semibold text-text-body hover:text-text-dark">
          Analytics
        </Link>
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0">
        {tab === 'details' ? (
          <Details property={property} />
        ) : tab === 'inspections' ? (
          <div className="flex min-w-0 flex-col gap-6">
            <OwnerInspectionTimes propertyId={property.id} />
            <InspectionRecords mode="owner" propertyId={property.id} />
          </div>
        ) : (
          <PropertyApplications
            listing={{ id: property.id, title: property.title, price: property.price }}
            applications={list}
            error={listError}
            onRetry={() => { setApplicationsError(null); setApplicationsAttempt((value) => value + 1); }}
            onUpdated={replaceApplication}
          />
        )}
      </div>
    </div>
  );
}

function Details({ property }: { property: Property }) {
  const photos = property.photo_urls ?? [];
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <section aria-labelledby="about-heading" className="min-w-0 rounded-2xl border border-border bg-white p-5">
        <h2 id="about-heading" className="font-heading text-h4 font-semibold text-text-dark">About this home</h2>
        <p className="mt-2 whitespace-pre-line break-words text-sm text-text-body">{property.description || 'No description yet.'}</p>
        {property.amenities?.length ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {property.amenities.map((amenity) => (
              <li key={amenity} className="rounded-full bg-surface px-3 py-1 text-sm font-medium text-primary-strong">{amenity}</li>
            ))}
          </ul>
        ) : null}
      </section>
      <section aria-labelledby="terms-heading" className="min-w-0 rounded-2xl border border-border bg-white p-5">
        <h2 id="terms-heading" className="font-heading text-h4 font-semibold text-text-dark">Rooms and terms</h2>
        <dl className="mt-2 space-y-1 text-sm">
          <Row label="Type" value={PROPERTY_TYPE_LABELS[property.property_type ?? ''] ?? 'Not given'} />
          <Row label="Bedrooms" value={property.bedrooms != null ? String(property.bedrooms) : 'Not given'} />
          <Row label="Bathrooms" value={property.bathrooms != null ? String(property.bathrooms) : 'Not given'} />
          <Row label="Parking" value={property.parking != null ? String(property.parking) : 'Not given'} />
          <Row label="Bond" value={property.bond != null ? formatMoney(property.bond) : 'Not given'} />
          <Row label="Lease term" value={property.lease_term ?? 'Not given'} />
          <Row label="Available from" value={property.available_from ? formatDate(property.available_from) : 'Not given'} />
        </dl>
      </section>
      {photos.length > 1 ? (
        <section aria-labelledby="photos-heading" className="min-w-0 rounded-2xl border border-border bg-white p-5 lg:col-span-2">
          <h2 id="photos-heading" className="font-heading text-h4 font-semibold text-text-dark">Photos ({photos.length})</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos.map((photo, index) => (
              <li key={`${photo}-${index}`} className="relative h-28 overflow-hidden rounded-xl">
                <Image src={photo} alt={`Photo ${index + 1} of ${photos.length}`} fill sizes="(min-width: 640px) 25vw, 50vw" className="object-cover" unoptimized={isRemoteImage(photo)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-white p-4">
      <dt className="text-xs text-text-body">{label}</dt>
      <dd className="mt-1 break-words text-lg font-bold text-text-dark">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-border py-1.5 last:border-b-0">
      <dt className="text-text-body">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-text-dark">{value}</dd>
    </div>
  );
}
