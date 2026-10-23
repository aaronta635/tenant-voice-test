'use client';

// A listing's reviews (tracker R12): the category averages and every
// published review, newest first. The API decides what each viewer gets:
// nobody's name, the private eviction answer only for its author, and the
// photos only for signed-in members, through links that expire.

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import Modal from '@/app/components/ui/Modal';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  categoryAverages,
  overallAverage,
  propertyReviewsApi,
  type PropertyReview,
  type ReportReason,
} from '@/app/lib/property-reviews';

const card = 'min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6';

type Loaded = { id: string; reviews: PropertyReview[] | null; error: string | null };

function Stars({ value, size = 'text-base' }: { value: number; size?: string }) {
  const stars = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className={`font-semibold text-text-dark ${size}`}>
      <span className="sr-only">{stars} out of 5 stars</span>
      <span aria-hidden>{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
    </span>
  );
}

export default function PropertyReviews({ propertyId, viewerRole, signInHref }: {
  propertyId: string;
  /** The signed-in viewer's role, or null signed out. */
  viewerRole: string | null;
  signInHref: string;
}) {
  const id = useId();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reporting, setReporting] = useState<PropertyReview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    propertyReviewsApi.forProperty(propertyId).then(
      (reviews) => { if (active) setLoaded({ id: propertyId, reviews, error: null }); },
      (error) => {
        if (active) setLoaded({ id: propertyId, reviews: null, error: error instanceof ApiError ? error.message : 'Please try again.' });
      },
    );
    return () => { active = false; };
  }, [propertyId, attempt]);

  const current = loaded?.id === propertyId ? loaded : null;
  const reviews = current?.reviews ?? [];
  const averages = categoryAverages(reviews).filter((category) => category.count > 0);
  const overall = overallAverage(reviews);
  const signedIn = viewerRole !== null;

  function reported(review: PropertyReview) {
    setLoaded((previous) => previous?.reviews
      ? { ...previous, reviews: previous.reviews.map((item) => item.id === review.id ? { ...item, reported_by_me: true } : item) }
      : previous);
    setReporting(null);
    setNotice('Thanks: the review was reported. A TenantVoice moderator will check it.');
  }

  return (
    <section aria-labelledby="reviews-heading" className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="reviews-heading" className="font-heading text-h4 font-semibold text-text-dark">Reviews</h2>
          {overall !== null ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-body">
              <Stars value={overall} size="text-sm" />
              <span>{overall.toFixed(1)} out of 5 from {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}</span>
            </p>
          ) : null}
        </div>
        {viewerRole === 'tenant' ? (
          <ButtonLink href={`/tenant/write-review?property=${encodeURIComponent(propertyId)}`} variant="secondary" size="sm">
            Write a review
          </ButtonLink>
        ) : null}
      </div>

      <div ref={noticeRef} tabIndex={-1} className="focus:outline-none">
        <FormMessage success={notice} className="mt-3" />
      </div>

      {!current ? (
        <p role="status" className="mt-3 text-sm text-text-body">Loading reviews…</p>
      ) : current.error ? (
        <div className="mt-3 rounded-xl border border-border p-4">
          <p className="text-sm text-text-dark">Couldn&apos;t load the reviews. {current.error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => { setLoaded(null); setAttempt((value) => value + 1); }}>
            Try again
          </Button>
        </div>
      ) : reviews.length === 0 ? (
        <p className="mt-3 text-sm text-text-body">No reviews yet for this listing.</p>
      ) : (
        <>
          {averages.length ? (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-text-dark">Detailed ratings</h3>
              <dl className="mt-2 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                {averages.map((category) => (
                  <div key={category.key} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <dt className="min-w-0 text-text-body">{category.label}</dt>
                      <dd className="font-semibold text-text-dark">
                        {category.average?.toFixed(1)}<span className="sr-only"> out of 5, from {category.count} {category.count === 1 ? 'review' : 'reviews'}</span>
                      </dd>
                    </div>
                    <div aria-hidden className="mt-1 h-1.5 rounded-full bg-surface">
                      <div className="h-full rounded-full bg-primary-strong" style={{ width: `${((category.average ?? 0) / 5) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          <ul className="mt-4 divide-y divide-border" aria-label="Review history">
            {reviews.map((review) => (
              <ReviewItem
                key={review.id}
                review={review}
                signedIn={signedIn}
                signInHref={signInHref}
                headingId={`${id}-${review.id}`}
                onReport={() => { setNotice(null); setReporting(review); }}
              />
            ))}
          </ul>
        </>
      )}

      {/* Only while open: the page keeps no closed dialog around. */}
      {reporting ? (
        <ReportDialog review={reporting} onClose={() => setReporting(null)} onReported={reported} returnFocus={() => noticeRef.current} />
      ) : null}
    </section>
  );
}

function ReviewItem({ review, signedIn, signInHref, headingId, onReport }: {
  review: PropertyReview;
  signedIn: boolean;
  signInHref: string;
  headingId: string;
  onReport: () => void;
}) {
  const photos = review.photos ?? [];
  const issues = review.reported_issues ?? [];
  const hiddenPhotos = (review.photo_count ?? 0) - photos.length;
  const recommends = typeof review.would_recommend === 'boolean' ? review.would_recommend : null;
  const disclosed = typeof review.issues_disclosed === 'boolean' ? review.issues_disclosed : null;
  const privateAnswer = review.mine && typeof review.maintenance_or_eviction_issue === 'boolean'
    ? review.maintenance_or_eviction_issue
    : null;
  return (
    <li className="py-4" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="break-words text-sm font-semibold text-text-dark">
            {review.title || (review.mine ? 'Your review' : review.client_name || 'Tenant')}
          </h3>
          <p className="text-xs text-text-body">
            {review.mine ? 'Your review' : review.client_name || 'Tenant'} · {formatDate(review.created_at)}
          </p>
        </div>
        <Stars value={review.rating} />
      </div>
      {review.comment ? <p className="mt-2 whitespace-pre-line break-words text-sm text-text-body">{review.comment}</p> : null}
      {review.pros || review.cons || review.advice_to_owner ? (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {review.pros ? <Detail term="Pros" value={review.pros} /> : null}
          {review.cons ? <Detail term="Cons" value={review.cons} /> : null}
          {review.advice_to_owner ? <Detail term="Advice to the landlord" value={review.advice_to_owner} /> : null}
        </dl>
      ) : null}
      {recommends !== null || disclosed !== null || issues.length ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="What the tenant reported">
          {recommends !== null ? <Tag>{recommends ? 'Would recommend' : 'Would not recommend'}</Tag> : null}
          {disclosed !== null ? (
            <Tag>{disclosed ? 'Problems disclosed before the lease' : 'Problems not disclosed before the lease'}</Tag>
          ) : null}
          {issues.map((issue) => <Tag key={issue}>{issue}</Tag>)}
        </ul>
      ) : null}
      {photos.length ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Photos">
          {photos.map((photo, index) => (
            <li key={photo.url}>
              <a href={photo.url} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-xl border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={`Photo ${index + 1} of ${photos.length} with this review`} className="size-full object-cover" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {hiddenPhotos > 0 && !signedIn ? (
        <p className="mt-2 text-sm text-text-body">
          {hiddenPhotos} {hiddenPhotos === 1 ? 'photo' : 'photos'} with this review.{' '}
          <Link href={signInHref} className="font-semibold text-primary-strong underline">Sign in</Link> to see them.
        </p>
      ) : null}
      {privateAnswer !== null ? (
        <p className="mt-3 rounded-xl border border-warning bg-white p-3 text-sm text-text-dark">
          <span className="font-semibold text-warning">Your answer: </span>
          {privateAnswer
            ? 'you left because you were asked to after asking for repairs.'
            : 'you were not asked to leave after asking for repairs.'}
          {' '}On this website only you and the moderators see it; in the TenantVoice app, signed-in members can see it
          with your name.
        </p>
      ) : null}
      {review.provider_reply ? (
        <div className="mt-3 rounded-xl border-l-2 border-primary bg-surface p-3">
          <p className="text-xs font-semibold text-text-dark">Landlord&apos;s reply</p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-text-body">{review.provider_reply}</p>
        </div>
      ) : null}
      {signedIn && !review.mine ? (
        review.reported_by_me ? (
          <p className="mt-2 text-xs text-text-body">You reported this review.</p>
        ) : (
          <Button variant="ghost" size="sm" className="mt-2" onClick={onReport}>
            Report<span className="sr-only"> this review</span>
          </Button>
        )
      ) : null}
    </li>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-text-body">{term}</dt>
      <dd className="whitespace-pre-line break-words text-text-dark">{value}</dd>
    </div>
  );
}

function Tag({ children }: { children: string }) {
  return <li className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-primary-strong">{children}</li>;
}

function ReportDialog({ review, onClose, onReported, returnFocus }: {
  review: PropertyReview;
  onClose: () => void;
  onReported: (review: PropertyReview) => void;
  /** Where focus goes once the report is sent: its Report button is gone by then. */
  returnFocus: () => HTMLElement | null;
}) {
  const id = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!reason) {
      setError('Choose why you are reporting this review.');
      return;
    }
    if (details.trim().length > REPORT_DETAILS_MAX) {
      setError(`Extra details can be up to ${REPORT_DETAILS_MAX} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await propertyReviewsApi.report(review.id, reason, details);
      setReason(null);
      setDetails('');
      onReported(review);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'The report was not sent. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="Report this review" onClose={() => { setError(null); onClose(); }} busy={busy} returnFocus={returnFocus}>
      <p className="text-sm text-text-body">
        A TenantVoice moderator checks every report. The review stays up until they decide, and the reviewer is not told who reported it.
      </p>
      <div role="group" aria-labelledby={`${id}-reason`} className="mt-4 min-w-0">
        <p id={`${id}-reason`} className="text-sm font-semibold text-text-dark">Why are you reporting it?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {REPORT_REASONS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={reason === option.key}
              onClick={() => setReason(option.key)}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong ${reason === option.key ? 'border-primary-strong bg-primary-strong text-white' : 'border-control-border bg-white text-text-dark hover:bg-surface'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <label htmlFor={`${id}-details`} className="mt-3 block text-sm font-semibold text-text-dark">
        Anything else? <span className="font-normal text-text-body">(optional)</span>
      </label>
      <textarea id={`${id}-details`} rows={3} value={details} onChange={(event) => setDetails(event.target.value)}
        aria-describedby={`${id}-count`}
        className="mt-1.5 w-full rounded-lg border border-control-border bg-white px-3 py-2.5 text-sm text-text-dark focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-strong" />
      <p id={`${id}-count`} className="mt-1 text-xs text-text-body">{details.trim().length} of {REPORT_DETAILS_MAX} characters</p>
      <FormMessage error={error} className="mt-3" />
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <Button variant="ghost" onClick={() => { setError(null); onClose(); }} disabled={busy}>Cancel</Button>
        <Button onClick={() => void send()} disabled={busy}>{busy ? 'Sending…' : 'Send report'}</Button>
      </div>
    </Modal>
  );
}
