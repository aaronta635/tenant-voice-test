'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminViewLink from '@/app/components/admin/AdminViewLink';
import ReasonDialog from '@/app/components/admin/ReasonDialog';
import StatePill, { type PillTone } from '@/app/components/admin/StatePill';
import ProfilePagination from '@/app/components/public-profiles/ProfilePagination';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import {
  adminModerationApi,
  DECISION_LABELS,
  parseReviewFilters,
  REVIEW_PAGE_SIZE,
  REVIEW_STATUS_LABELS,
  REVIEW_VIEW_LABELS,
  reviewFiltersHref,
  type ModeratedReview,
  type ReviewAction,
  type ReviewQueue,
  type ReviewStatus,
  type ReviewView,
} from '@/app/lib/admin-moderation-api';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatDate } from '@/app/lib/format';
import { REPORT_REASONS, REVIEW_CATEGORIES } from '@/app/lib/property-reviews';

type Result = { key: string; queue: ReviewQueue | null; error: string | null };
type Deciding = { review: ModeratedReview; action: ReviewAction } | null;

const VIEWS = Object.keys(REVIEW_VIEW_LABELS) as ReviewView[];
const TONES: Record<ReviewStatus, PillTone> = { PUBLISHED: 'success', FLAGGED: 'warning', HIDDEN: 'danger', ARCHIVED: 'neutral' };
// mobile_report_review's reasons, and those older reports kept.
const REASONS: Record<string, string> = {
  ...Object.fromEntries(REPORT_REASONS.map(({ key, label }) => [key, label])),
  false_information: 'False information',
};
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(REVIEW_CATEGORIES.map(({ key, label }) => [key, label]));

function yesNo(value: boolean | null | undefined) {
  return value === null || value === undefined ? 'Not answered' : value ? 'Yes' : 'No';
}

const EMPTY: Record<ReviewView, { title: string; body: string }> = {
  reported: { title: 'Nothing to decide', body: 'No reported review is waiting for a decision.' },
  hidden: { title: 'No hidden reviews', body: 'No review has been hidden.' },
};

function about(review: ModeratedReview) {
  return review.property_title ?? review.reviewed?.full_name ?? 'a member';
}

/**
 * The review report queue (GET /admin/reviews) with its view and page in the
 * URL. A reported review is hidden or kept published, and a hidden one
 * restored, each with a reason; the review, its reports and every decision
 * stay on the record either way.
 */
export default function AdminReviews() {
  const id = useId();
  const params = useSearchParams();
  const filters = parseReviewFilters(params);
  const { view, page: pageNumber } = filters;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [deciding, setDeciding] = useState<Deciding>(null);
  const [message, setMessage] = useState<string | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const key = JSON.stringify([filters, attempt]);
  const current = result?.key === key ? result : null;

  useEffect(() => {
    let active = true;
    adminModerationApi.reviews({ view, page: pageNumber }).then(
      (queue) => { if (active) setResult({ key, queue, error: null }); },
      (error) => { if (active) setResult({ key, queue: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [key, view, pageNumber]);

  useEffect(() => { if (message) focusResult(messageRef.current, listRef.current); }, [message]);

  function decided(review: ModeratedReview, text: string) {
    setDeciding(null);
    setMessage(text);
    // The review leaves this view: the counts and the page are read again.
    setResult((previous) => (previous?.queue
      ? { ...previous, queue: { ...previous.queue, items: previous.queue.items.filter((item) => item.id !== review.id) } }
      : previous));
    setAttempt((value) => value + 1);
  }

  const queue = current?.queue ?? (result?.queue && result.queue.view === view ? result.queue : null);
  const total = queue?.total ?? 0;
  const first = (pageNumber - 1) * REVIEW_PAGE_SIZE + 1;
  const shown = queue?.items.length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Reviews"
        description="Reviews someone reported wait here for a decision. A hidden review leaves every public page; the review, its reports and each decision stay on record."
      />

      <nav aria-label="Review views" className="min-w-0">
        <ul className="flex flex-wrap gap-2">
          {VIEWS.map((tab) => (
            <li key={tab}>
              <AdminViewLink href={reviewFiltersHref({ view: tab, page: 1 })} selected={tab === view}>
                {REVIEW_VIEW_LABELS[tab]}
                {queue ? <span className={tab === view ? 'text-white' : 'text-text-dark'}>({queue.counts[tab] ?? 0})</span> : null}
              </AdminViewLink>
            </li>
          ))}
        </ul>
      </nav>

      <div ref={messageRef} tabIndex={-1}>
        <FormMessage success={message} />
      </div>

      <section ref={listRef} aria-labelledby={`${id}-results`} aria-busy={!current} className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={`${id}-results`} className="font-heading text-h4 font-semibold text-text-dark">
            {queue ? `${total} ${view === 'reported' ? 'reported' : 'hidden'} ${total === 1 ? 'review' : 'reviews'}` : 'Reviews'}
          </h2>
          <p role="status" className="text-sm text-text-body">
            {!current ? 'Loading the queue…' : shown ? `Showing ${first}–${first + shown - 1} of ${total}` : ''}
          </p>
        </div>
        {!queue && !current ? (
          <ul aria-hidden className="mt-4 space-y-4">
            {[0, 1].map((index) => <li key={index} className="h-40 animate-pulse rounded-2xl border border-border bg-white" />)}
          </ul>
        ) : !queue ? (
          <div className="mt-4">
            <LoadErrorCard title="Couldn't load the reviews" message={current?.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
          </div>
        ) : shown === 0 ? (
          <Card className="mt-4 flex flex-col items-start gap-3 p-6">
            <h3 className="font-heading text-h4 font-semibold">{total ? 'No reviews on this page' : EMPTY[view].title}</h3>
            <p className="text-sm text-text-body">{total ? 'This list has fewer pages.' : EMPTY[view].body}</p>
            {total ? <AdminViewLink href={reviewFiltersHref({ view, page: 1 })} selected={false}>Go to the first page</AdminViewLink> : null}
          </Card>
        ) : (
          <>
            <ul className="mt-4 space-y-4">
              {queue.items.map((review) => (
                <li key={review.id}>
                  <ReviewCard review={review} view={view} onDecide={(action) => setDeciding({ review, action })} />
                </li>
              ))}
            </ul>
            <ProfilePagination
              page={pageNumber}
              totalPages={Math.ceil(total / REVIEW_PAGE_SIZE)}
              hrefFor={(number) => reviewFiltersHref({ ...filters, page: number })}
            />
          </>
        )}
      </section>

      <DecisionDialog
        deciding={deciding}
        onClose={() => setDeciding(null)}
        onDecided={decided}
        onStale={() => setAttempt((value) => value + 1)}
        returnFocus={() => messageRef.current}
      />
    </div>
  );
}

function ReviewCard({ review, view, onDecide }: { review: ModeratedReview; view: ReviewView; onDecide: (action: ReviewAction) => void }) {
  const reviewer = review.reviewer?.full_name ?? 'A member';
  const flaggedElsewhere = review.status === 'FLAGGED' && review.reports.length === 0;
  const ratings = Object.entries(review.ratings ?? {});
  const details = review.details;
  const photos = review.photos ?? [];
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm text-text-body">
            <StatePill tone={TONES[review.status] ?? 'neutral'}>{REVIEW_STATUS_LABELS[review.status] ?? review.status}</StatePill>
            <span>{review.rating} of 5 stars</span>
            {review.is_verified_interaction ? <span>Verified tenancy</span> : null}
            {review.created_at ? <span>Written {formatDate(review.created_at)}</span> : null}
          </p>
          <h3 className="mt-2 break-words font-heading text-base font-semibold text-text-dark">
            {reviewer}&apos;s review of {about(review)}
          </h3>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {view === 'reported' ? (
            <>
              <Button variant="destructive" size="sm" onClick={() => onDecide('hide')}>
                Hide<span className="sr-only"> {reviewer}&apos;s review</span>
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onDecide('restore')}>
                Keep published<span className="sr-only"> {reviewer}&apos;s review</span>
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => onDecide('restore')}>
              Restore<span className="sr-only"> {reviewer}&apos;s review</span>
            </Button>
          )}
        </div>
      </div>

      {review.title ? <p className="break-words text-sm font-semibold text-text-dark">{review.title}</p> : null}
      <p className="whitespace-pre-wrap break-words text-sm text-text-dark">{review.body || 'No written review.'}</p>
      {review.reply ? (
        <p className="whitespace-pre-wrap break-words rounded-lg bg-background px-3 py-2 text-sm text-text-body">
          Reply: {review.reply}
        </p>
      ) : null}

      {ratings.length || details || review.photo_count ? (
        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          {ratings.length ? (
            <div className="min-w-0">
              <h4 className="text-xs font-bold uppercase tracking-wide text-text-body">Ratings</h4>
              <dl className="mt-2 space-y-1 text-sm">
                {ratings.map(([key, score]) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt className="text-text-body">{CATEGORY_LABELS[key] ?? key}</dt>
                    <dd className="font-semibold text-text-dark">{score} of 5</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {details ? (
            <div className="min-w-0">
              <h4 className="text-xs font-bold uppercase tracking-wide text-text-body">Details</h4>
              <dl className="mt-2 space-y-1 text-sm">
                {details.pros ? <AdminDetail term="Pros" value={details.pros} /> : null}
                {details.cons ? <AdminDetail term="Cons" value={details.cons} /> : null}
                {details.advice_to_owner ? <AdminDetail term="Advice to the landlord" value={details.advice_to_owner} /> : null}
                <AdminDetail term="Would recommend" value={yesNo(details.would_recommend)} />
                <AdminDetail term="Problems disclosed before the lease" value={yesNo(details.issues_disclosed)} />
                {details.reported_issues.length ? <AdminDetail term="Problems" value={details.reported_issues.join('; ')} /> : null}
                <AdminDetail
                  term="Private: left after asking for repairs"
                  value={yesNo(details.maintenance_or_eviction_issue)}
                />
              </dl>
              <p className="mt-1 text-xs text-text-body">The private answer is never shown on the listing.</p>
            </div>
          ) : null}
          {review.photo_count ? (
            <div className="min-w-0 sm:col-span-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-text-body">Photos ({review.photo_count})</h4>
              {photos.length ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {photos.map((photo, index) => (
                    <li key={photo.url}>
                      <a href={photo.url} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.url} alt={`Photo ${index + 1} with ${reviewer}'s review`} className="size-full object-cover" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-text-body">The photos could not be opened right now. Reload the queue to try again.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div className="min-w-0">
          <h4 className="text-xs font-bold uppercase tracking-wide text-text-body">
            Reports{review.open_reports ? ` · ${review.open_reports} waiting` : ''}
          </h4>
          {flaggedElsewhere ? (
            <p className="mt-2 text-sm text-text-body">Flagged, with no report on record.</p>
          ) : review.reports.length === 0 ? (
            <p className="mt-2 text-sm text-text-body">No reports.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {review.reports.map((report) => (
                <li key={report.id} className="min-w-0">
                  <p className="text-text-dark">
                    {report.reporter?.full_name ?? 'Someone'} · {formatDate(report.created_at)}{report.open ? '' : ' · decided'}
                  </p>
                  <p className="break-words text-text-body">
                    {REASONS[report.reason ?? ''] ?? report.reason ?? 'No reason given'}
                    {report.details ? `: ${report.details}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          <h4 className="text-xs font-bold uppercase tracking-wide text-text-body">Decisions</h4>
          {review.decisions.length === 0 ? (
            <p className="mt-2 text-sm text-text-body">None yet.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {review.decisions.map((decision) => (
                <li key={decision.id} className="min-w-0">
                  <p className="text-text-dark">
                    {DECISION_LABELS[decision.decision ?? ''] ?? decision.decision} by {decision.actor?.full_name ?? 'an admin'} · {formatDate(decision.created_at)}
                  </p>
                  {decision.reason ? <p className="break-words text-text-body">{decision.reason}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function AdminDetail({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <dt className="text-text-body">{term}</dt>
      <dd className="min-w-0 break-words font-medium text-text-dark">{value}</dd>
    </div>
  );
}

function DecisionDialog({ deciding, onClose, onDecided, onStale, returnFocus }: {
  deciding: Deciding;
  onClose: () => void;
  onDecided: (review: ModeratedReview, message: string) => void;
  /** The review changed since the queue loaded (409): the queue reloads behind the dialog. */
  onStale: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const review = deciding?.review;
  const hide = deciding?.action === 'hide';
  const reviewer = review?.reviewer?.full_name ?? 'The reviewer';
  const restoring = review ? review.status === 'HIDDEN' || review.status === 'ARCHIVED' : false;
  const title = hide ? 'Hide this review' : restoring ? 'Restore this review' : 'Keep this review published';
  const effect = hide
    ? `It leaves every public page at once. ${reviewer} is told why, and the people who reported it are told it was hidden.`
    : restoring
      ? `It shows on public pages again. ${reviewer} is told why.`
      : 'It stays on public pages, no longer marked as reported. The people who reported it are told it was kept.';
  return (
    <ReasonDialog
      key={deciding ? `${deciding.review.id}-${deciding.action}` : 'none'}
      open={deciding !== null}
      title={title}
      effect={<p>{effect}</p>}
      confirmLabel={hide ? 'Hide review' : restoring ? 'Restore review' : 'Keep published'}
      tone={hide ? 'destructive' : 'primary'}
      reasonHelp="Kept with the decision, your name and the time. The reviewer is told it when their review changes."
      onClose={onClose}
      onConfirm={async (reason) => {
        if (!deciding) return null;
        try {
          const updated = await adminModerationApi.moderateReview(deciding.review, deciding.action, reason);
          onDecided(updated, hide
            ? `The review was hidden. ${reviewer} was told why.`
            : restoring ? 'The review was restored.' : 'The review stays published.');
          return null;
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) onStale();
          return error instanceof ApiError ? error.message : 'The decision was not saved. Please try again.';
        }
      }}
      returnFocus={returnFocus}
    />
  );
}
