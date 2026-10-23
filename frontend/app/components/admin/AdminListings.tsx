'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AdminFilterSelect from '@/app/components/admin/AdminFilterSelect';
import ReasonDialog from '@/app/components/admin/ReasonDialog';
import StatePill, { type PillTone } from '@/app/components/admin/StatePill';
import ProfilePagination from '@/app/components/public-profiles/ProfilePagination';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import {
  adminModerationApi,
  DECISION_LABELS,
  LISTING_PAGE_SIZE,
  LISTING_STATUS_LABELS,
  listingFiltersHref,
  parseListingFilters,
  type ListingAction,
  type ListingPage,
  type ListingStatus,
  type ModeratedListing,
} from '@/app/lib/admin-moderation-api';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatDate, formatMoney } from '@/app/lib/format';
import { setSearchParams } from '@/app/lib/page-url';

type Result = { key: string; page: ListingPage | null; error: string | null };
type Deciding = { listing: ModeratedListing; action: ListingAction } | null;

const TONES: Record<ListingStatus, PillTone> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  PAUSED: 'warning',
  APPLICATIONS_CLOSED: 'info',
  LEASED: 'info',
  ARCHIVED: 'neutral',
};
// Listings a visitor can find, and so open on the public site.
const PUBLIC = new Set<ListingStatus>(['PUBLISHED', 'APPLICATIONS_CLOSED']);

/**
 * Every listing (GET /admin/listings) with its filters in the URL. A
 * published listing can be paused, and any listing not rented archived, each
 * with a reason its owner, and any agent who manages it, are told: the API
 * lists the moves each listing has.
 */
export default function AdminListings() {
  const id = useId();
  const params = useSearchParams();
  const filters = parseListingFilters(params);
  const { status, q, page: pageNumber } = filters;
  const [draft, setDraft] = useState({ q: filters.q, seen: filters.q });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [deciding, setDeciding] = useState<Deciding>(null);
  const [message, setMessage] = useState<string | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const key = JSON.stringify([filters, attempt]);
  const current = result?.key === key ? result : null;

  let query = draft.q;
  if (draft.seen !== filters.q) {
    query = filters.q;
    setDraft({ q: filters.q, seen: filters.q });
  }

  useEffect(() => {
    let active = true;
    adminModerationApi.listings({ status, q, page: pageNumber }).then(
      (found) => { if (active) setResult({ key, page: found, error: null }); },
      (error) => { if (active) setResult({ key, page: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [key, status, q, pageNumber]);

  useEffect(() => { if (message) focusResult(messageRef.current, listRef.current); }, [message]);

  function decided(listing: ModeratedListing, text: string) {
    setDeciding(null);
    setMessage(text);
    setResult((previous) => (previous?.page
      ? { ...previous, page: { ...previous.page, items: previous.page.items.map((item) => (item.id === listing.id ? listing : item)) } }
      : previous));
  }

  const page = current?.page;
  const total = page?.total ?? 0;
  const first = (pageNumber - 1) * LISTING_PAGE_SIZE + 1;
  const filtered = Boolean(status || q);
  const pausing = deciding?.action === 'pause';
  const decidingTitle = deciding?.listing.title ?? 'this listing';

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Listings"
        description="Every listing on TenantVoice, newest first. Pause one that breaks the rules until its owner fixes it, or archive it for good."
      />

      <form
        role="search"
        aria-label="Listings"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-end"
        onSubmit={(event) => { event.preventDefault(); setSearchParams({ q: query.trim() || null, page: null }, 'push'); }}
      >
        <Input
          label="Title"
          type="search"
          maxLength={100}
          value={query}
          onChange={(event) => setDraft({ q: event.target.value, seen: filters.q })}
        />
        <AdminFilterSelect
          label="Status"
          value={status}
          options={Object.entries(LISTING_STATUS_LABELS) as [ListingStatus, string][]}
          onChange={(value) => setSearchParams({ status: value || null, page: null }, 'push')}
        />
        <Button type="submit" className="sm:col-span-2 lg:col-span-1">Search</Button>
      </form>

      <div ref={messageRef} tabIndex={-1}>
        <FormMessage success={message} />
      </div>

      <section ref={listRef} aria-labelledby={`${id}-results`} aria-busy={!current} className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={`${id}-results`} className="font-heading text-h4 font-semibold text-text-dark">
            {page ? `${total} ${total === 1 ? 'listing' : 'listings'}` : 'Listings'}
          </h2>
          <p role="status" className="text-sm text-text-body">
            {!current ? 'Loading listings…' : page?.items.length ? `Showing ${first}–${first + page.items.length - 1} of ${total}` : ''}
          </p>
        </div>
        {!current ? (
          <ul aria-hidden className="mt-4 space-y-3">
            {[0, 1, 2].map((index) => <li key={index} className="h-24 animate-pulse rounded-xl border border-border bg-white" />)}
          </ul>
        ) : !page ? (
          <LoadErrorCard title="Couldn't load the listings" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
        ) : page.items.length === 0 ? (
          <Card className="mt-4 flex flex-col items-start gap-3 p-6">
            <h3 className="font-heading text-h4 font-semibold">{total ? 'No listings on this page' : 'No listings found'}</h3>
            <p className="text-sm text-text-body">
              {total ? 'This list has fewer pages.' : filtered ? 'Try another title or status.' : 'Nobody has listed a property yet.'}
            </p>
            {filtered || total ? (
              <Button variant="secondary" onClick={() => setSearchParams({ status: null, q: null, page: null }, 'push')}>Clear the filters</Button>
            ) : null}
          </Card>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-white">
              {page.items.map((listing) => (
                <ListingRow key={listing.id} listing={listing} onDecide={(action) => setDeciding({ listing, action })} />
              ))}
            </ul>
            <ProfilePagination
              page={pageNumber}
              totalPages={Math.ceil(total / LISTING_PAGE_SIZE)}
              hrefFor={(number) => listingFiltersHref({ ...filters, page: number })}
            />
          </>
        )}
      </section>

      <ReasonDialog
        key={deciding ? `${deciding.listing.id}-${deciding.action}` : 'none'}
        open={deciding !== null}
        title={pausing ? `Pause “${decidingTitle}”` : `Archive “${decidingTitle}”`}
        effect={(
          <p>
            {pausing
              ? 'It leaves search and its page at once. Its owner is told why, and may publish it again once it is fixed.'
              : 'It leaves search and the owner’s listings for good, as a listing its owner deleted. Its owner is told why.'}
          </p>
        )}
        confirmLabel={pausing ? 'Pause listing' : 'Archive listing'}
        reasonHelp="Sent to the owner in a notification, and kept with the decision, your name and the time."
        onClose={() => setDeciding(null)}
        onConfirm={async (reason) => {
          if (!deciding) return null;
          try {
            const listing = await adminModerationApi.moderateListing(deciding.listing, deciding.action, reason);
            decided(listing, `“${listing.title}” was ${pausing ? 'paused' : 'archived'}. Its owner was told why.`);
            return null;
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) setAttempt((value) => value + 1);
            return error instanceof ApiError ? error.message : 'The decision was not saved. Please try again.';
          }
        }}
        returnFocus={() => messageRef.current}
      />
    </div>
  );
}

function ListingRow({ listing, onDecide }: { listing: ModeratedListing; onDecide: (action: ListingAction) => void }) {
  const decision = listing.last_decision;
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          {PUBLIC.has(listing.status) ? (
            <Link href={`/properties/${encodeURIComponent(listing.id)}`} className="break-words font-semibold text-primary-strong underline">
              {listing.title}
            </Link>
          ) : (
            <span className="break-words font-semibold text-text-dark">{listing.title}</span>
          )}
          <StatePill tone={TONES[listing.status] ?? 'neutral'}>{LISTING_STATUS_LABELS[listing.status] ?? listing.status}</StatePill>
        </p>
        <p className="mt-1 break-words text-sm text-text-body">{listing.address || listing.suburb || 'No address'}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-body">
          <span>{formatMoney(listing.weekly_rent)} a week</span>
          <span>
            Owner{' '}
            {listing.owner ? (
              <Link href={`/admin/users/${encodeURIComponent(listing.owner.id)}`} className="font-semibold text-primary-strong underline">
                {listing.owner.full_name ?? 'an account'}
              </Link>
            ) : 'unknown'}
          </span>
          {listing.manager ? <span>Managed by {listing.manager.full_name ?? 'an agent'}</span> : null}
          {listing.created_at ? <span>Listed {formatDate(listing.created_at)}</span> : null}
        </p>
        {decision ? (
          <p className="mt-2 break-words text-sm text-text-body">
            {DECISION_LABELS[decision.decision ?? ''] ?? decision.decision} by {decision.actor?.full_name ?? 'an admin'} on {formatDate(decision.created_at)}
            {decision.reason ? `: ${decision.reason}` : ''}
          </p>
        ) : null}
      </div>
      {listing.actions.length ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          {listing.actions.includes('pause') ? (
            <Button variant="secondary" size="sm" onClick={() => onDecide('pause')}>Pause<span className="sr-only"> {listing.title}</span></Button>
          ) : null}
          {listing.actions.includes('archive') ? (
            <Button variant="ghost" size="sm" onClick={() => onDecide('archive')}>Archive<span className="sr-only"> {listing.title}</span></Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
