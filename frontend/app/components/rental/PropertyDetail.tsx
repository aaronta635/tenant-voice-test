'use client';

// Shared by the public listing page (/properties/[id]) and the tenant one
// (/tenant/properties/[id]); the route supplies the surrounding chrome and
// the main landmark. The API decides what a viewer sees: signed out, the
// listing has no street address, and no one's contact details are in it.

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import InspectionBooking from '@/app/components/inspections/InspectionBooking';
import ApplyPanel from '@/app/components/rental/ApplyPanel';
import LikeButton from '@/app/components/rental/LikeButton';
import NoPhotoYet from '@/app/components/rental/NoPhotoYet';
import PropertyReviews from '@/app/components/rental/PropertyReviews';
import ProfileAvatar from '@/app/components/public-profiles/ProfileAvatar';
import RatingBadge from '@/app/components/trust/RatingBadge';
import VerifiedBadge from '@/app/components/trust/VerifiedBadge';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import {
  api,
  ApiError,
  type ListingLandlord,
  type Property,
} from '@/app/lib/api';
import { authPageHref } from '@/app/lib/auth-redirect';
import { formatDate, formatMoney } from '@/app/lib/format';
import { PROPERTY_TYPE_LABELS, listingStatusOf, localityOf } from '@/app/lib/listings';
import { isRemoteImage } from '@/app/lib/remote-image';

const card = 'min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6';

type Loaded = { id: string; property: Property };

function availableFrom(value: string | null): string {
  return value ? formatDate(value) : 'Ask the landlord';
}

export default function PropertyDetail({ backHref = '/properties' }: { backHref?: string }) {
  const params = useParams<{ propertyId: string }>();
  const propertyId = (Array.isArray(params.propertyId) ? params.propertyId[0] : params.propertyId) ?? '';
  const pathname = usePathname();
  // Each read is kept with the id it was for, so a page opened for another
  // listing never shows the last one's details while it loads.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ id: string; notFound: boolean; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    api.properties.getPublic(propertyId).then(
      (property) => {
        if (cancelled) return;
        setLoaded({ id: propertyId, property });
        setFailure(null);
      },
      (err) => {
        if (cancelled) return;
        setFailure({
          id: propertyId,
          notFound: err instanceof ApiError && err.status === 404,
          message: err instanceof ApiError ? err.message : 'This listing could not be loaded right now.',
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [propertyId, attempt]);

  const property = loaded && loaded.id === propertyId ? loaded.property : null;
  const failed = failure && failure.id === propertyId ? failure : null;

  useEffect(() => {
    if (property) document.title = `${property.title} - TenantVoice`;
  }, [property]);

  if (failed?.notFound) {
    return (
      <StateCard title="Listing not found" backHref={backHref}>
        This listing may have been leased, paused or removed by its landlord, or the link may be wrong.
      </StateCard>
    );
  }
  if (failed) {
    return (
      <StateCard
        title="Couldn't load this listing"
        backHref={backHref}
        action={
          <Button variant="secondary" onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}>
            Try again
          </Button>
        }
      >
        {failed.message}
      </StateCard>
    );
  }
  if (!property) return <LoadingListing />;

  const viewer = property.viewer ?? null;
  const signedIn = Boolean(viewer?.role);
  const status = listingStatusOf(property);
  const locality = localityOf(property);
  // Signed out (or an older response), address holds only the suburb: never a street.
  const addressLine = property.address_hidden === false ? property.address : locality || property.address;
  const signInHref = authPageHref('/login', 'tenant', pathname);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex flex-wrap items-center gap-2 text-text-body">
          <li>
            <Link href={backHref} className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
              Rentals
            </Link>
          </li>
          <li aria-hidden>›</li>
          <li aria-current="page" className="min-w-0 break-words text-text-dark">{property.suburb ?? property.title}</li>
        </ol>
      </nav>

      <section aria-labelledby="listing-title" className="mt-2 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0">
          <h1 id="listing-title" className="break-words font-heading text-h2 font-bold text-text-dark sm:text-h1">{property.title}</h1>
          <p className="mt-2 break-words text-lg text-text-dark">{addressLine}</p>
          {!signedIn && property.address_hidden !== false ? (
            <p className="mt-1 text-sm text-text-body">
              <Link href={signInHref} className="font-semibold text-primary-strong underline">Sign in</Link> to see the street address.
            </p>
          ) : null}
          <p className="mt-4 font-heading text-h2 font-bold text-text-dark">
            {formatMoney(property.price)}<span className="text-base font-medium text-text-body">/week</span>
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-dark" aria-label="Rooms">
            <li>{property.bedrooms ?? '—'} bed</li>
            <li>{property.bathrooms ?? '—'} bath</li>
            <li>{property.parking ?? 0} car</li>
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-sm font-semibold ${status === 'published' ? 'border-success text-success' : 'border-warning text-warning'}`}>
              {status === 'published' ? 'Taking applications' : 'Applications closed'}
            </span>
            <LikeButton
              key={property.id}
              listingId={property.id}
              count={property.like_count ?? 0}
              liked={viewer?.liked ?? false}
              canLike={viewer?.role === 'tenant'}
              signInHref={signedIn ? null : signInHref}
            />
          </div>
        </div>
        <Gallery
          key={property.id}
          photos={property.photo_urls ?? []}
          title={property.title}
          rating={<RatingBadge average={property.review_count ? property.rating_avg : null} count={property.review_count} />}
        />
      </section>

      <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <aside aria-label="Apply and contact" className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-start-1">
          <section aria-labelledby="price-heading" className={card}>
            <h2 id="price-heading" className="text-xs font-semibold uppercase tracking-[0.08em] text-text-body">Asking rent</h2>
            <p className="mt-1 font-heading text-h3 font-bold text-primary-strong">
              {formatMoney(property.price)}<span className="text-sm font-medium text-text-body"> a week</span>
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Bond" value={property.bond != null ? formatMoney(property.bond) : 'Ask the landlord'} />
              <Row label="Available" value={availableFrom(property.available_from)} />
            </dl>
            <div className="mt-5">
              <ApplyPanel property={property} viewer={viewer} pathname={pathname} manageHref={`/owner/properties/${property.id}`} />
            </div>
          </section>
          <LandlordCard landlord={property.landlord ?? null} propertyId={property.id} title={property.title} viewerRole={viewer?.role ?? null} isOwner={viewer?.is_owner ?? false} signInHref={signInHref} />
          <section aria-labelledby="inspections-heading" className={card}>
            <h2 id="inspections-heading" className="font-heading text-h4 font-semibold text-text-dark">Inspection times</h2>
            <InspectionBooking
              propertyId={property.id}
              role={viewer?.role ?? null}
              isOwner={viewer?.is_owner ?? false}
              signInHref={signInHref}
              manageHref={`/owner/properties/${property.id}?tab=inspections`}
            />
          </section>
        </aside>

        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
          <section aria-labelledby="description-heading" className={card}>
            <h2 id="description-heading" className="font-heading text-h4 font-semibold text-text-dark">About this home</h2>
            <p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed text-text-body">
              {property.description || "The landlord hasn't added a description yet."}
            </p>
          </section>
          <section aria-labelledby="details-heading" className={card}>
            <h2 id="details-heading" className="font-heading text-h4 font-semibold text-text-dark">Property details</h2>
            <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <Row label="Type" value={PROPERTY_TYPE_LABELS[property.property_type ?? ''] ?? 'Not given'} />
              <Row label="Bedrooms" value={property.bedrooms != null ? String(property.bedrooms) : 'Not given'} />
              <Row label="Bathrooms" value={property.bathrooms != null ? String(property.bathrooms) : 'Not given'} />
              <Row label="Parking" value={property.parking != null ? String(property.parking) : 'Not given'} />
              <Row label="Lease term" value={property.lease_term ?? 'Ask the landlord'} />
              <Row label="Available" value={availableFrom(property.available_from)} />
            </dl>
            {property.amenities?.length ? (
              <>
                <h3 className="mt-5 text-sm font-semibold text-text-dark">Features</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {property.amenities.map((feature) => (
                    <li key={feature} className="rounded-full bg-surface px-3 py-1 text-sm font-medium text-primary-strong">{feature}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
          <PropertyReviews propertyId={property.id} viewerRole={viewer?.role ?? null} signInHref={signInHref} />
        </div>
      </div>
    </div>
  );
}

function Gallery({ photos, title, rating }: { photos: string[]; title: string; rating: ReactNode }) {
  const [shown, setShown] = useState(0);
  const current = photos[shown];
  return (
    <div className="min-w-0">
      <div className="relative h-64 overflow-hidden rounded-2xl border border-border bg-surface sm:h-80">
        {current ? (
          <Image
            src={current}
            alt={`Photo ${shown + 1} of ${photos.length} of ${title}`}
            fill
            priority
            sizes="(min-width: 1024px) 820px, 100vw"
            className="object-cover"
            unoptimized={isRemoteImage(current)}
          />
        ) : (
          <NoPhotoYet />
        )}
        <div className="absolute left-4 top-4">{rating}</div>
      </div>
      {photos.length > 1 ? (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Photos">
          {photos.map((photo, index) => (
            <li key={`${photo}-${index}`} className="shrink-0">
              <button
                type="button"
                aria-pressed={index === shown}
                aria-label={`Show photo ${index + 1} of ${photos.length}`}
                onClick={() => setShown(index)}
                className={`relative block size-16 overflow-hidden rounded-xl border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong ${index === shown ? 'border-primary-strong' : 'border-transparent'}`}
              >
                <Image src={photo} alt="" fill sizes="64px" className="object-cover" unoptimized={isRemoteImage(photo)} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LandlordCard({ landlord, propertyId, title, viewerRole, isOwner, signInHref }: {
  landlord: ListingLandlord | null;
  propertyId: string;
  title: string;
  viewerRole: string | null;
  isOwner: boolean;
  signInHref: string;
}) {
  return (
    <section aria-labelledby="landlord-heading" className={card}>
      <h2 id="landlord-heading" className="text-xs font-semibold uppercase tracking-[0.08em] text-text-body">Landlord</h2>
      {landlord ? (
        <div className="mt-3 flex min-w-0 items-start gap-3">
          <ProfileAvatar name={landlord.display_name} url={landlord.avatar_url} />
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-1.5 font-semibold text-text-dark">
              <span className="break-words">{landlord.display_name}</span>
              {landlord.verified ? <VerifiedBadge size="sm" /> : null}
            </p>
            <p className="text-sm text-text-body">{landlord.role_label}</p>
            <div className="mt-1"><RatingBadge average={landlord.rating_avg} count={landlord.review_count} /></div>
            <Link href={`/public/${landlord.id}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary-strong underline">
              View profile
            </Link>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-text-dark">Listed by a TenantVoice landlord.</p>
      )}
      <p className="mt-3 text-sm text-text-body">Contact details stay private: message the landlord through TenantVoice.</p>
      <div className="mt-4">
        {isOwner ? null : viewerRole === 'tenant' ? (
          <MessageLandlordButton propertyId={propertyId} title={title} />
        ) : viewerRole === null ? (
          <ButtonLink href={signInHref} variant="secondary" fullWidth>Sign in to message the landlord</ButtonLink>
        ) : null}
      </div>
    </section>
  );
}

function MessageLandlordButton({ propertyId, title }: { propertyId: string; title: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function start() {
    setState('sending');
    try {
      await api.conversations.startRental({ property_id: propertyId, subject: title, body: `Hi — I'm interested in ${title}.` });
      setState('sent');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') {
    return <ButtonLink href="/tenant/messages" variant="secondary" fullWidth>Open conversation</ButtonLink>;
  }
  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" fullWidth onClick={() => void start()} disabled={state === 'sending'}>
        {state === 'sending' ? 'Opening…' : 'Message the landlord'}
      </Button>
      {state === 'error' ? <p role="alert" className="text-sm text-danger">The conversation couldn&apos;t be opened. Please try again.</p> : null}
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

function StateCard({ title, backHref, action, children }: {
  title: string;
  backHref: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-10 sm:px-6">
      <section className={`${card} mx-auto max-w-xl text-center`}>
        <h1 className="font-heading text-h3 font-semibold text-text-dark">{title}</h1>
        <p className="mt-2 text-sm text-text-body">{children}</p>
        {action ? <div className="mt-5">{action}</div> : null}
        <Link href={backHref} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-primary-strong underline">
          ← Back to rentals
        </Link>
      </section>
    </div>
  );
}

function LoadingListing() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8" aria-busy="true">
      <p role="status" className="sr-only">Loading listing…</p>
      <div aria-hidden className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="h-10 w-3/4 animate-pulse rounded-lg bg-surface" />
          <div className="h-5 w-1/2 animate-pulse rounded-lg bg-surface" />
          <div className="h-8 w-1/3 animate-pulse rounded-lg bg-surface" />
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-surface sm:h-80" />
      </div>
    </div>
  );
}
