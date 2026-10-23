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
import type { Party } from '@/app/lib/admin-complaints-api';
import {
  adminRepairsApi,
  parseRepairFilters,
  REPAIR_DECISION_LABELS,
  REPAIR_PAGE_SIZE,
  REPAIR_PRIORITY_LABELS,
  REPAIR_STATUS_LABELS,
  repairFiltersHref,
  type AdminRepair,
  type RepairAction,
  type RepairPage,
  type RepairPriority,
  type RepairStatus,
} from '@/app/lib/admin-repairs-api';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatDate, formatDateTime } from '@/app/lib/format';
import { setSearchParams } from '@/app/lib/page-url';
import { repairCategoryLabel } from '@/app/lib/provider-repairs';

type Result = { key: string; page: RepairPage | null; error: string | null };
type Deciding = { repair: AdminRepair; action: RepairAction } | null;

const TONES: Record<RepairStatus, PillTone> = {
  open: 'warning',
  in_progress: 'info',
  resolved: 'success',
  cancelled: 'neutral',
};

/**
 * Every repair (GET /admin/repairs) with its filters in the URL (status,
 * priority, q, page), so Back and a shared link keep the view. An open repair
 * can be cancelled (it will not be done) or closed (it is over), each with a
 * reason its tenant, owner and assigned provider are told. Admins move
 * repairs here only: the parties' repair pages refuse them.
 */
export default function AdminRepairs() {
  const id = useId();
  const params = useSearchParams();
  const filters = parseRepairFilters(params);
  const { status, priority, q, page: pageNumber } = filters;
  const [draft, setDraft] = useState({ q: filters.q, seen: filters.q });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [deciding, setDeciding] = useState<Deciding>(null);
  const [message, setMessage] = useState<string | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const key = JSON.stringify([filters, attempt]);
  const current = result?.key === key ? result : null;

  // Typed text follows the URL when Back or a link changes q.
  let query = draft.q;
  if (draft.seen !== filters.q) {
    query = filters.q;
    setDraft({ q: filters.q, seen: filters.q });
  }

  useEffect(() => {
    let active = true;
    adminRepairsApi.list({ status, priority, q, page: pageNumber }).then(
      (found) => { if (active) setResult({ key, page: found, error: null }); },
      (error) => { if (active) setResult({ key, page: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [key, status, priority, q, pageNumber]);

  useEffect(() => { if (message) focusResult(messageRef.current, listRef.current); }, [message]);

  function decided(repair: AdminRepair, text: string) {
    setDeciding(null);
    setMessage(text);
    setResult((previous) => (previous?.page
      ? { ...previous, page: { ...previous.page, items: previous.page.items.map((item) => (item.id === repair.id ? repair : item)) } }
      : previous));
  }

  const page = current?.page;
  const total = page?.total ?? 0;
  const first = (pageNumber - 1) * REPAIR_PAGE_SIZE + 1;
  const filtered = Boolean(status || priority || q);
  const cancelling = deciding?.action === 'cancel';
  const decidingTitle = deciding?.repair.title ?? 'this repair';

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Repairs"
        description="Every repair tenants have asked for, newest first. Cancel one that will not be done, or close one that is over, with the reason its people are told."
      />

      <form
        role="search"
        aria-label="Repairs"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_auto] lg:items-end"
        onSubmit={(event) => { event.preventDefault(); setSearchParams({ q: query.trim() || null, page: null }, 'push'); }}
      >
        <Input
          label="Title or description"
          type="search"
          maxLength={100}
          value={query}
          onChange={(event) => setDraft({ q: event.target.value, seen: filters.q })}
        />
        <AdminFilterSelect
          label="Status"
          value={status}
          options={Object.entries(REPAIR_STATUS_LABELS) as [RepairStatus, string][]}
          onChange={(value) => setSearchParams({ status: value || null, page: null }, 'push')}
        />
        <AdminFilterSelect
          label="Priority"
          value={priority}
          options={Object.entries(REPAIR_PRIORITY_LABELS) as [RepairPriority, string][]}
          onChange={(value) => setSearchParams({ priority: value || null, page: null }, 'push')}
        />
        <Button type="submit" className="sm:col-span-2 lg:col-span-1">Search</Button>
      </form>

      <div ref={messageRef} tabIndex={-1}>
        <FormMessage success={message} />
      </div>

      <section ref={listRef} aria-labelledby={`${id}-results`} aria-busy={!current} className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={`${id}-results`} className="font-heading text-h4 font-semibold text-text-dark">
            {page ? `${total} ${total === 1 ? 'repair' : 'repairs'}` : 'Repairs'}
          </h2>
          <p role="status" className="text-sm text-text-body">
            {!current ? 'Loading repairs…' : page?.items.length ? `Showing ${first}–${first + page.items.length - 1} of ${total}` : ''}
          </p>
        </div>
        {!current ? (
          <ul aria-hidden className="mt-4 space-y-3">
            {[0, 1, 2].map((index) => <li key={index} className="h-24 animate-pulse rounded-xl border border-border bg-white" />)}
          </ul>
        ) : !page ? (
          <LoadErrorCard title="Couldn't load the repairs" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
        ) : page.items.length === 0 ? (
          <Card className="mt-4 flex flex-col items-start gap-3 p-6">
            <h3 className="font-heading text-h4 font-semibold">{total ? 'No repairs on this page' : 'No repairs found'}</h3>
            <p className="text-sm text-text-body">
              {total ? 'This list has fewer pages.' : filtered ? 'Try another status, priority or search.' : 'No tenant has asked for a repair yet.'}
            </p>
            {filtered || total ? (
              <Button variant="secondary" onClick={() => setSearchParams({ status: null, priority: null, q: null, page: null }, 'push')}>
                Clear the filters
              </Button>
            ) : null}
          </Card>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-white">
              {page.items.map((repair) => (
                <RepairRow key={repair.id} repair={repair} onDecide={(action) => setDeciding({ repair, action })} />
              ))}
            </ul>
            <ProfilePagination
              page={pageNumber}
              totalPages={Math.ceil(total / REPAIR_PAGE_SIZE)}
              hrefFor={(number) => repairFiltersHref({ ...filters, page: number })}
            />
          </>
        )}
      </section>

      <ReasonDialog
        key={deciding ? `${deciding.repair.id}-${deciding.action}` : 'none'}
        open={deciding !== null}
        title={cancelling ? `Cancel “${decidingTitle}”` : `Close “${decidingTitle}”`}
        effect={(
          <p>
            {cancelling
              ? 'The repair will not be done: it and its case close as cancelled, and the visit, if one is booked, is off.'
              : 'The repair is over: it and its case close as done, though no provider marked it.'}
            {' '}Its tenant, owner and assigned provider are told why.
          </p>
        )}
        confirmLabel={cancelling ? 'Cancel repair' : 'Close repair'}
        tone={cancelling ? 'destructive' : 'primary'}
        reasonHelp="Sent to the tenant, owner and provider, kept as the repair's note in their pages, and kept with the decision, your name and the time."
        onClose={() => setDeciding(null)}
        onConfirm={async (reason) => {
          if (!deciding) return null;
          try {
            const repair = await adminRepairsApi.decide(deciding.repair, deciding.action, reason);
            decided(repair, `“${repair.title}” was ${cancelling ? 'cancelled' : 'closed'}. Its tenant, owner and provider were told why.`);
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

function PartyLink({ party, fallback }: { party: Party | null; fallback: string }) {
  if (!party) return <>{fallback}</>;
  return (
    <Link href={`/admin/users/${encodeURIComponent(party.id)}`} className="font-semibold text-primary-strong underline">
      {party.full_name ?? 'an account'}
    </Link>
  );
}

function RepairRow({ repair, onDecide }: { repair: AdminRepair; onDecide: (action: RepairAction) => void }) {
  const decision = repair.last_decision;
  const place = [repair.property_title, repair.area].filter(Boolean).join(', ');
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words font-semibold text-text-dark">{repair.title}</span>
          <StatePill tone={TONES[repair.status] ?? 'neutral'}>{REPAIR_STATUS_LABELS[repair.status] ?? repair.status}</StatePill>
        </p>
        <p className="mt-1 break-words text-sm text-text-body">{place || 'No listing named'}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-body">
          <span>{repairCategoryLabel(repair.category)}</span>
          <span>{REPAIR_PRIORITY_LABELS[repair.priority] ?? repair.priority} priority</span>
          <span>Asked {formatDate(repair.created_at)}</span>
          {repair.appointment_at ? <span>Visit {formatDateTime(repair.appointment_at)}</span> : null}
        </p>
        {/* A party with no name shows their email, which has no break in it: each may shrink and wrap. */}
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-body">
          <span className="min-w-0 break-words">Tenant <PartyLink party={repair.tenant} fallback="unknown" /></span>
          <span className="min-w-0 break-words">Owner <PartyLink party={repair.owner} fallback="unknown" /></span>
          <span className="min-w-0 break-words">Provider <PartyLink party={repair.provider} fallback="not assigned" /></span>
        </p>
        {/* An admin's decision keeps its reason as the note: shown once, with the decision. */}
        {repair.resolution_note && repair.resolution_note !== decision?.reason ? (
          <p className="mt-2 break-words text-sm text-text-body">Note: {repair.resolution_note}</p>
        ) : null}
        {decision ? (
          <p className="mt-2 break-words text-sm text-text-body">
            {REPAIR_DECISION_LABELS[decision.decision ?? ''] ?? decision.decision} by {decision.actor?.full_name ?? 'an admin'} on {formatDate(decision.created_at)}
            {decision.reason ? `: ${decision.reason}` : ''}
          </p>
        ) : null}
      </div>
      {repair.actions.length ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          {repair.actions.includes('close') ? (
            <Button variant="secondary" size="sm" onClick={() => onDecide('close')}>Close repair<span className="sr-only"> {repair.title}</span></Button>
          ) : null}
          {repair.actions.includes('cancel') ? (
            <Button variant="ghost" size="sm" onClick={() => onDecide('cancel')}>Cancel repair<span className="sr-only"> {repair.title}</span></Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
