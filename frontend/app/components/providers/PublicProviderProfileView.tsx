'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import BookingCard from '@/app/components/providers/BookingCard';
import DemoNotice from '@/app/components/provider/DemoNotice';
import ConnectButton from '@/app/components/trust/ConnectButton';
import RatingBadge from '@/app/components/trust/RatingBadge';
import ReportedBadge from '@/app/components/trust/ReportedBadge';
import VerifiedBadge from '@/app/components/trust/VerifiedBadge';
import FormMessage from '@/app/components/ui/FormMessage';
import { isDemoProvider } from '@/app/lib/demo';
import { useClientReady } from '@/app/lib/use-client-ready';
import { api, ApiError, getAuthToken, type Availability, type PortfolioItem, type ProviderService, type PublicProvider, type Review } from '@/app/lib/api';
import { formatDate, formatRating, formatServicePrice } from '@/app/lib/format';
import { providerBadge, providerFirstName, providerHref, providerImage, providerLocation, providerName, providerServiceAreaLabel, providerYearsLabel } from '@/app/lib/provider-view';
import { getClientSessionRole, messagesHrefForRole } from '@/app/lib/session-role';

/** verified: the owner's account is approved, as their public profile says (the page reads it). */
type Props = { provider: PublicProvider & { verified?: boolean }; services: ProviderService[]; reviews: Review[]; availability: Availability[]; portfolio: PortfolioItem[]; listingHref?: string };
const card = 'rounded-2xl border border-border bg-white p-5 print:break-inside-avoid';

export default function PublicProviderProfileView({ provider, services, reviews, availability, portfolio, listingHref }: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [ownershipError, setOwnershipError] = useState(false);
  const [ownershipRetry, setOwnershipRetry] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);
  // A new object per click, so picking the same service again re-applies it after the card's own select changed.
  const [serviceRequest, setServiceRequest] = useState<{ id: string }>();
  const [reviewLimit, setReviewLimit] = useState(4);
  const [reviewRating, setReviewRating] = useState('all');
  const bookingRef = useRef<HTMLDivElement>(null);
  const clientReady = useClientReady();
  const signedIn = clientReady && !!getAuthToken();
  const role = clientReady ? getClientSessionRole() : null;
  useEffect(() => {
    let cancelled = false;
    if (signedIn && role === 'Provider') void api.profiles.me().then((profile) => { if (!cancelled) { setViewerId(profile.id); setOwnershipError(false); } }).catch(() => { if (!cancelled) setOwnershipError(true); });
    return () => { cancelled = true; };
  }, [signedIn, role, ownershipRetry]);
  const isOwnProfile = signedIn && viewerId === provider.profile_id;
  const checkingOwnership = signedIn && role === 'Provider' && !viewerId;
  const name = providerName(provider);
  const rating = formatRating(provider.rating_avg, provider.review_count);
  // The listing the visitor came from keeps their filters; sign-in returns here with it.
  const backHref = listingHref ?? (provider.category_slug ? `/categories/${provider.category_slug}` : '/categories');
  const profilePath = `/providers/${provider.slug ?? provider.id}${listingHref ? `?from=${encodeURIComponent(listingHref)}` : ''}`;
  // Any account type can book or message a provider, so sign-in preselects none.
  const loginHref = `/login?next=${encodeURIComponent(profilePath)}`;
  const activeServices = services.filter((service) => service.is_active);
  const photos = useMemo(() => {
    const items = [...portfolio.map((item) => ({ src: item.image_url, title: item.title || item.description })), ...(provider.gallery_urls ?? []).map((src) => ({ src, title: null }))];
    return items.filter((item, index) => !!item.src && items.findIndex((candidate) => candidate.src === item.src) === index);
  }, [provider.gallery_urls, portfolio]);
  const filteredReviews = reviews.filter((review) => reviewRating === 'all' || review.rating === Number(reviewRating));

  async function shareProfile() {
    setMessageError(null); setCopied(false);
    // The profile itself: the address bar can also hold this visitor's listing and booking choices.
    const url = `${window.location.origin}${providerHref(provider)}`;
    try {
      if (navigator.share) { await navigator.share({ title: name, url }); return; }
      await navigator.clipboard.writeText(url); setCopied(true);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setMessageError(`Could not share this profile. Copy this link: ${url}`);
    }
  }
  async function messageProvider() {
    if (!signedIn) { router.push(loginHref); return; }
    if (messaging || isOwnProfile || checkingOwnership) return;
    setMessaging(true); setMessageError(null); setCopied(false);
    try {
      const thread = await api.conversations.startMarketplace({ provider_id: provider.id, subject: `Chat with ${name}` });
      router.push(`${messagesHrefForRole(role)}?thread=${thread.id}`);
    } catch (error) { setMessageError(error instanceof ApiError ? error.message : 'Could not open a conversation.'); }
    finally { setMessaging(false); }
  }
  function chooseService(id: string) {
    setServiceRequest({ id });
    const target = bookingRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target?.focus({ preventScroll: true });
  }
  const booking = isOwnProfile ? <section className={card}><h2 className="font-bold">Your public profile</h2><p className="mt-2 text-sm text-text-body">This is how clients see your profile.</p><Link href="/dashboard/profile" className="mt-3 inline-flex min-h-11 items-center font-semibold text-primary-strong underline">Edit profile</Link></section> : checkingOwnership ? <div className={card}>{ownershipError ? <><p role="alert" className="text-danger">Could not check your account.</p><button className="mt-2 min-h-11 font-semibold text-primary-strong underline" onClick={() => { setOwnershipError(false); setOwnershipRetry((value) => value + 1); }}>Try again</button></> : <p role="status">Checking your account…</p>}</div> : <BookingCard key={provider.id} providerId={provider.id} providerFirstName={providerFirstName(provider)} services={services} availability={availability} availabilityNote={provider.availability_note} requestedService={serviceRequest} listingHref={listingHref} />;
  return <div className="min-w-0 bg-background text-text-dark">
    {isDemoProvider(provider.profile_id) ? <div className="mx-auto max-w-[1200px] px-4 pt-4 print:hidden"><DemoNotice /></div> : null}
    <header className="border-b border-border bg-white print:hidden">
      <div className="mx-auto flex min-h-16 max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 py-2">
        <Link href={backHref} className="inline-flex min-h-11 items-center whitespace-nowrap px-2 text-sm font-semibold text-text-body">← Providers</Link>
        <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={shareProfile} className="min-h-11 rounded-xl border border-control-border px-3 text-sm font-semibold">{copied ? 'Copied' : 'Share'}</button>
          {isOwnProfile ? <Link href="/dashboard/profile" className="inline-flex min-h-11 items-center rounded-xl border border-control-border px-3 text-sm font-semibold">Edit profile</Link> : <button type="button" aria-busy={messaging} disabled={messaging || checkingOwnership} onClick={messageProvider} className="min-h-11 whitespace-nowrap rounded-xl border border-transparent bg-primary-strong px-3 text-sm font-semibold text-white disabled:opacity-60">{messaging ? 'Opening…' : 'Message'}</button>}
        </div>
      </div>
      <div className="mx-auto max-w-[1200px] px-4"><FormMessage className="break-words" error={messageError} success={copied ? 'Profile link copied.' : null} /></div>
    </header>
    <div className="mx-auto grid max-w-[1200px] min-w-0 gap-6 px-4 py-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="contents">
        <section className={`${card} xl:col-start-1 xl:row-start-1`}>
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
            <div className="relative size-28 shrink-0 overflow-hidden rounded-2xl bg-surface"><Image src={providerImage(provider)} alt={provider.profiles?.avatar_url ? name : 'No provider photo yet'} fill sizes="112px" className="object-cover" /></div>
            <div className="min-w-0 text-center sm:text-left"><div className="flex min-w-0 items-start justify-center gap-2 sm:justify-start"><h1 className="min-w-0 break-words font-heading text-2xl font-bold">{name}</h1>{provider.verified ? <VerifiedBadge className="mt-1.5" /> : null}</div><p className="mt-1 text-sm text-text-body">Service provider · {provider.category_name || provider.category || 'Property services'}</p><p className="mt-1 text-sm text-text-body">{providerLocation(provider)}</p><div className="mt-2"><RatingBadge average={provider.rating_avg} count={provider.review_count} /></div>
              {providerBadge(provider) ? <p className="mt-2 text-xs font-bold text-primary-strong">{providerBadge(provider)}</p> : null}
              {provider.verifications.length ? <ul aria-label="Verified credentials" className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">{provider.verifications.map((value) => <li key={value} className="rounded-full border border-success/40 bg-success/10 px-3 py-1 text-xs font-semibold text-success">✓ {value === 'Insured' ? 'Insurance verified' : `${value} verified`}</li>)}</ul> : null}
              {/* Signed in or out is known once hydrated; until then the button would offer the wrong one. */}
              {clientReady && !isOwnProfile ? <ConnectButton key={provider.profile_id} userId={provider.profile_id} name={name} signedIn={signedIn} returnTo={profilePath} className="mt-4 justify-center sm:justify-start print:hidden" /> : null}
            </div>
          </div>
        </section>
        <section className={`${card} xl:col-start-1 xl:row-start-2`}><h2 className="font-heading text-xl font-bold">About</h2><p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-text-body">{provider.bio || provider.tagline || 'This provider has not written a bio yet.'}</p><dl className="mt-4 space-y-2 text-sm">{provider.years_experience != null ? <Row label="Experience" value={providerYearsLabel(provider)} /> : null}{provider.languages?.length ? <Row label="Languages" value={provider.languages.join(', ')} /> : null}{provider.specialties?.length ? <Row label="Specialties" value={provider.specialties.join(', ')} /> : null}</dl></section>
        <section className={`${card} xl:col-start-1 xl:row-start-3`}><h2 className="font-heading text-xl font-bold">Services</h2>
          {activeServices.length ? <div className="mt-3 divide-y divide-border">{activeServices.map((service) => <article key={service.id} className="py-4 print:break-inside-avoid"><h3 className="font-semibold">{service.title}</h3>{service.description ? <p className="mt-1 whitespace-pre-line text-sm text-text-body">{service.description}</p> : null}<p className="mt-2 text-sm font-semibold">{formatServicePrice(service.price, service.pricing_type)}{service.duration_minutes ? ` · ${service.duration_minutes} minutes` : ''}</p>{service.inclusions ? <p className="mt-2 text-sm text-text-body">Includes: {service.inclusions}</p> : null}{service.exclusions ? <p className="mt-1 text-sm text-text-body">Excludes: {service.exclusions}</p> : null}{service.cancellation_policy ? <p className="mt-1 text-sm text-text-body">Cancellation: {service.cancellation_policy}</p> : null}{!isOwnProfile && !checkingOwnership ? <button onClick={() => chooseService(service.id)} className="mt-2 min-h-11 font-semibold text-primary-strong underline print:hidden" aria-label={`Book ${service.title}`}>Book this service</button> : null}</article>)}</div> : <p className="mt-3 text-sm text-text-body">No services listed yet.</p>}
        </section>
        {/* Sign-in returns to #booking, so the anchor is the booking form itself. */}
        <div id="booking" ref={bookingRef} tabIndex={-1} className="min-w-0 scroll-mt-24 xl:col-start-2 xl:row-start-1 xl:row-span-3 xl:self-start print:hidden">{booking}</div>
        <section className={`${card} xl:col-start-1 xl:row-start-4`}><h2 className="font-heading text-xl font-bold">Reviews</h2><p className="mt-2 text-sm text-text-body">{provider.review_count ? `${rating} out of 5 · ${provider.review_count} verified review${provider.review_count === 1 ? '' : 's'}` : 'No reviews yet'}</p>
          <div className="mt-4 space-y-2">{[5,4,3,2,1].map((stars) => { const count = reviews.filter((review) => review.rating === stars).length; return <div key={stars} className="flex items-center gap-3 text-sm"><span className="w-14 shrink-0">{stars} {stars === 1 ? 'star' : 'stars'}</span><div className="h-2 flex-1 rounded-full border border-control-border bg-surface" aria-hidden><div className="h-full rounded-full bg-primary forced-colors:bg-[Highlight]" style={{ width: `${reviews.length ? count / reviews.length * 100 : 0}%` }} /></div><span className="w-6 text-right">{count}</span></div>; })}</div>
          {reviews.length ? <><label className="mt-5 flex items-center gap-2 text-sm print:hidden">Filter reviews<select value={reviewRating} onChange={(event) => { setReviewRating(event.target.value); setReviewLimit(4); }} className="min-h-11 rounded-lg border border-control-border bg-white px-3"><option value="all">All ratings</option>{[5,4,3,2,1].map((stars) => <option value={stars} key={stars}>{stars} {stars === 1 ? 'star' : 'stars'}</option>)}</select></label>
            <p role="status" className="mt-3 text-sm text-text-body">Showing {Math.min(reviewLimit, filteredReviews.length)} of {filteredReviews.length} {filteredReviews.length === 1 ? 'review' : 'reviews'}</p>
            <div className="mt-3 space-y-4">{filteredReviews.slice(0,reviewLimit).map((review) => <article key={review.id} className="border-t border-border pt-4 print:break-inside-avoid"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{review.client_name ?? 'Verified client'}</h3><span className="text-sm font-semibold" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}{'☆'.repeat(5-review.rating)}</span></div><p className="mt-1 text-xs text-text-body">{[review.service_title,review.location,formatDate(review.created_at)].filter(Boolean).join(' · ')}</p>{review.is_flagged ? <ReportedBadge className="mt-2" /> : null}{review.comment ? <p className="mt-2 text-sm leading-relaxed text-text-body">{review.comment}</p> : null}{review.provider_reply ? <div className="mt-3 rounded-xl border-l-2 border-primary bg-surface p-3"><p className="text-xs font-semibold">Response from {name}{review.replied_at ? ` · ${formatDate(review.replied_at)}` : ''}</p><p className="mt-1 text-sm text-text-body">{review.provider_reply}</p></div> : null}</article>)}</div>
            {reviewLimit < filteredReviews.length ? <button onClick={() => setReviewLimit(filteredReviews.length)} className="mt-4 min-h-11 font-semibold text-primary-strong underline print:hidden">Show all {filteredReviews.length} reviews</button> : null}</> : null}
        </section>
        <section className={`${card} xl:col-start-1 xl:row-start-5`}><h2 className="font-heading text-xl font-bold">Work photos</h2><p className="mt-1 text-sm text-text-body">{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</p>{photos.length ? <div className="mt-4 grid gap-4 sm:grid-cols-2">{photos.map((photo,index) => <figure key={photo.src}><div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-surface"><Image src={photo.src} alt={photo.title || `Work photo ${index+1} by ${name}`} fill className="object-cover" sizes="(max-width: 640px) 90vw, 320px" /></div>{photo.title ? <figcaption className="mt-2 text-sm text-text-body">{photo.title}</figcaption> : null}</figure>)}</div> : <p className="mt-3 text-sm text-text-body">No work photos yet.</p>}</section>
      </div>
      <aside className="min-w-0 space-y-5 xl:col-start-2 xl:row-start-4 xl:row-span-2 xl:self-start">
        <section className={card}><h2 className="font-heading text-lg font-bold">Provider details</h2><dl className="mt-4 space-y-3 text-sm"><Row label="Service area" value={providerServiceAreaLabel(provider)} /><Row label="Jobs completed" value={String(provider.completed_jobs)} /><Row label="Member since" value={formatDate(provider.created_at)} />{provider.response_time ? <Row label="Response time" value={provider.response_time} /> : null}{provider.availability_note ? <Row label="Availability" value={provider.availability_note} /> : null}</dl></section>
        {!signedIn ? <section className={`${card} print:hidden`}><h2 className="font-bold">Contact this provider</h2><p className="mt-2 text-sm text-text-body">Sign in to message {providerFirstName(provider)} or request a booking.</p><Link href={loginHref} className="mt-3 inline-flex min-h-11 items-center font-semibold text-primary-strong underline">Sign in</Link></section> : null}
        <Link href={`/contact?topic=report-profile&provider=${encodeURIComponent(provider.slug ?? provider.id)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-strong underline print:hidden">Report this profile</Link>
      </aside>
    </div>
  </div>;
}
function Row({label,value}: {label:string;value:string}) { return <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-text-body">{label}</dt><dd className="font-medium">{value}</dd></div>; }
