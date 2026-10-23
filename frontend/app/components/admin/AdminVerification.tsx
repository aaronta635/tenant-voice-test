'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import VerificationItemCard from '@/app/components/admin/VerificationItemCard';
import ProfilePagination from '@/app/components/public-profiles/ProfilePagination';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import {
  adminApi,
  parseVerificationFilters,
  QUEUE_ROLE_LABELS,
  REVIEW_STATUS_LABELS,
  VERIFICATION_PAGE_SIZE,
  verificationHref,
  type QueueRole,
  type ReviewStatus,
  type VerificationItem,
  type VerificationQueue,
} from '@/app/lib/admin-api';
import { ApiError } from '@/app/lib/api';
import { navigateWithinPage } from '@/app/lib/page-url';

const QUEUE_ROLES = Object.keys(QUEUE_ROLE_LABELS) as QueueRole[];
const REVIEW_STATUSES = Object.keys(REVIEW_STATUS_LABELS) as ReviewStatus[];

// Who each tab lists, one and many: "1 provider", "3 landlords". The shared
// verification functions review no agent, so none is listed.
const NOUNS: Record<QueueRole, [string, string]> = {
  tenant: ['tenant', 'tenants'],
  landlord: ['landlord', 'landlords'],
  provider: ['provider', 'providers'],
};

const LISTED: Record<ReviewStatus, string> = {
  PENDING: 'with documents in review',
  APPROVED: 'with approved documents',
  REJECTED: 'with rejected documents',
};

const NONE: Record<ReviewStatus, { title: string; body: string }> = {
  PENDING: { title: 'Nothing to review', body: 'No document of these accounts is waiting for review.' },
  APPROVED: { title: 'No approved documents', body: 'No document of these accounts has been approved yet.' },
  REJECTED: { title: 'No rejected documents', body: 'No document of these accounts has been rejected.' },
};

type Result = { key: string; queue: VerificationQueue | null; error: string | null };

/**
 * GET /admin/verification with its tab, status and page in the URL, so Back
 * and a shared link keep the view; changes go through the History API
 * (lib/page-url). Each account is a VerificationItemCard, which decides its
 * documents and the account itself.
 */
export default function AdminVerification() {
  const id = useId();
  const params = useSearchParams();
  const filters = parseVerificationFilters(params);
  const { role, status, page: pageNumber } = filters;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = JSON.stringify([filters, attempt]);
  const current = result?.key === key ? result : null;

  useEffect(() => {
    let active = true;
    adminApi.verification({ role, status, page: pageNumber }).then(
      (queue) => { if (active) setResult({ key, queue, error: null }); },
      (error) => { if (active) setResult({ key, queue: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [key, role, status, pageNumber]);

  function reloaded(item: VerificationItem) {
    setResult((previous) => previous?.queue
      ? { ...previous, queue: { ...previous.queue, items: previous.queue.items.map((entry) => (entry.user_id === item.user_id ? item : entry)) } }
      : previous);
  }

  const queue = current?.queue;
  const total = queue?.total ?? 0;
  const first = (pageNumber - 1) * VERIFICATION_PAGE_SIZE + 1;
  const shown = queue?.items.length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Verification"
        description="Documents by account, with those sent from the mobile app. An account is verified once every document its role needs is approved."
      />

      <div className="flex min-w-0 flex-col gap-3">
        <nav aria-label="Account type" className="min-w-0">
          <ul className="flex flex-wrap gap-2">
            {QUEUE_ROLES.map((tab) => (
              <li key={tab}>
                <ChipLink href={verificationHref({ role: tab, status, page: 1 })} selected={tab === role}>
                  {QUEUE_ROLE_LABELS[tab]}
                  {queue ? <span className={tab === role ? 'text-white' : 'text-text-dark'}>({queue.counts[tab] ?? 0})</span> : null}
                </ChipLink>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Review status" className="min-w-0">
          <ul className="flex flex-wrap gap-2">
            {REVIEW_STATUSES.map((value) => (
              <li key={value}>
                <ChipLink href={verificationHref({ role, status: value, page: 1 })} selected={value === status}>
                  {REVIEW_STATUS_LABELS[value]}
                </ChipLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <section aria-labelledby={`${id}-results`} aria-busy={!current} className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={`${id}-results`} className="font-heading text-h4 font-semibold text-text-dark">
            {queue
              ? `${total} ${NOUNS[role][total === 1 ? 0 : 1]} ${LISTED[status]}`
              : `${QUEUE_ROLE_LABELS[role]} ${LISTED[status]}`}
          </h2>
          <p role="status" className="text-sm text-text-body">
            {!current ? 'Loading the queue…' : shown ? `Showing ${first}–${first + shown - 1} of ${total}` : ''}
          </p>
        </div>
        {!current ? (
          <ul aria-hidden className="mt-4 space-y-4">
            {[0, 1].map((index) => <li key={index} className="h-48 animate-pulse rounded-2xl border border-border bg-white" />)}
          </ul>
        ) : !queue ? (
          <div className="mt-4">
            <LoadErrorCard title="Couldn't load the queue" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
          </div>
        ) : (
          <>
            {queue.mobile_unavailable ? (
              <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-danger bg-white p-3 text-sm text-danger">
                <span>The documents sent from the mobile app could not be loaded, so they and accounts with only those are missing.</span>
                <Button variant="secondary" size="sm" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
              </div>
            ) : null}
            {shown === 0 ? (
              <Card className="mt-4 flex flex-col items-start gap-3 p-6">
                <h3 className="font-heading text-h4 font-semibold">{total ? 'No accounts on this page' : NONE[status].title}</h3>
                <p className="text-sm text-text-body">{total ? 'This list has fewer pages.' : NONE[status].body}</p>
                {total ? (
                  <ChipLink href={verificationHref({ role, status, page: 1 })} selected={false}>Go to the first page</ChipLink>
                ) : null}
              </Card>
            ) : (
              <>
                <ul className="mt-4 space-y-4">
                  {queue.items.map((item) => (
                    <li key={item.user_id}>
                      <VerificationItemCard item={item} status={status} onReloaded={reloaded} />
                    </li>
                  ))}
                </ul>
                <ProfilePagination
                  page={pageNumber}
                  totalPages={Math.ceil(total / VERIFICATION_PAGE_SIZE)}
                  hrefFor={(number) => verificationHref({ ...filters, page: number })}
                />
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** A link to another view of this page, chip-shaped as FilterChip; the current one is marked and checked. */
function ChipLink({ href, selected, children }: { href: string; selected: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      onNavigate={navigateWithinPage(href)}
      aria-current={selected ? 'page' : undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm transition-colors ${
        selected
          ? 'border-primary-strong bg-primary-strong font-bold text-white'
          : 'border-control-border bg-white font-medium text-text-body hover:bg-surface hover:text-text-dark'
      }`}
    >
      {selected ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="-ml-1 size-4 shrink-0" aria-hidden>
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      ) : null}
      {children}
    </Link>
  );
}
