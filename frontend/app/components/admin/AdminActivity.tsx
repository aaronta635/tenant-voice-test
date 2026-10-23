'use client';

import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminFilterSelect from '@/app/components/admin/AdminFilterSelect';
import AdminViewLink from '@/app/components/admin/AdminViewLink';
import ProfilePagination from '@/app/components/public-profiles/ProfilePagination';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import Input from '@/app/components/ui/Input';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import { ROLE_LABELS } from '@/app/lib/admin-api';
import {
  ACTIVITY_LOG_LABELS,
  ACTIVITY_PAGE_SIZE,
  activityFiltersHref,
  adminActivityApi,
  ENTITY_LABELS,
  ENTITY_NOUNS,
  parseActivityFilters,
  type ActivityEntry,
  type ActivityFilters,
  type ActivityLog,
  type ActivityPage,
} from '@/app/lib/admin-activity-api';
import { ApiError } from '@/app/lib/api';
import { messageTimestamp } from '@/app/lib/format';
import { setSearchParams } from '@/app/lib/page-url';

type Result = { key: string; page: ActivityPage | null; error: string | null };
type Draft = Pick<ActivityFilters, 'actor' | 'action' | 'from' | 'to'>;

const LOGS = Object.keys(ACTIVITY_LOG_LABELS) as ActivityLog[];
const LOG_HELP: Record<ActivityLog, string> = {
  admin: 'Decisions made in the admin consoles of both apps. Reported reviews wait in the review queue.',
  web: 'Every change a request made on the web, and the events the web names.',
};

function draftOf(filters: ActivityFilters): Draft {
  return { actor: filters.actor, action: filters.action, from: filters.from, to: filters.to };
}

/**
 * The audit logs (GET /admin/activity), one at a time, with their filters in
 * the URL: the admin log of decisions and the web log of requests. Each entry
 * names who did what, to which row, and when.
 */
export default function AdminActivity() {
  const id = useId();
  const params = useSearchParams();
  const filters = parseActivityFilters(params);
  const [draft, setDraft] = useState({ values: draftOf(filters), seen: JSON.stringify(draftOf(filters)) });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = JSON.stringify([filters, attempt]);
  const current = result?.key === key ? result : null;
  const { log, actor, action, entity, from, to, page: pageNumber } = filters;

  // The typed filters follow the URL when Back or a link changes them.
  let values = draft.values;
  const seen = JSON.stringify(draftOf(filters));
  if (draft.seen !== seen) {
    values = draftOf(filters);
    setDraft({ values, seen });
  }

  useEffect(() => {
    let active = true;
    adminActivityApi.activity({ log, actor, action, entity, from, to, page: pageNumber }).then(
      (found) => { if (active) setResult({ key, page: found, error: null }); },
      (error) => { if (active) setResult({ key, page: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [key, log, actor, action, entity, from, to, pageNumber]);

  function edit(change: Partial<Draft>) {
    setDraft({ values: { ...values, ...change }, seen });
  }

  const page = current?.page;
  const total = page?.total ?? 0;
  const first = (pageNumber - 1) * ACTIVITY_PAGE_SIZE + 1;
  const filtered = Boolean(actor || action || entity || from || to);

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
      <PageHeader title="Activity log" description="Who did what on TenantVoice, and when. Times are in Sydney." />

      <nav aria-label="Logs" className="min-w-0">
        <ul className="flex flex-wrap gap-2">
          {LOGS.map((tab) => (
            <li key={tab}>
              <AdminViewLink href={activityFiltersHref({ ...filters, log: tab, page: 1 })} selected={tab === log}>
                {ACTIVITY_LOG_LABELS[tab]}
              </AdminViewLink>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-text-body">{LOG_HELP[log]}</p>
      </nav>

      <form
        role="search"
        aria-label="Activity"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setSearchParams({
            actor: values.actor.trim() || null, action: values.action.trim() || null,
            from: values.from || null, to: values.to || null, page: null,
          }, 'push');
        }}
      >
        <Input label="Person" type="search" maxLength={100} value={values.actor} onChange={(event) => edit({ actor: event.target.value })} />
        <Input label="Action" type="search" maxLength={80} value={values.action} onChange={(event) => edit({ action: event.target.value })} />
        <AdminFilterSelect
          label="Kind"
          value={entity}
          options={Object.entries(ENTITY_LABELS) as [string, string][]}
          onChange={(value) => setSearchParams({ entity: value || null, page: null }, 'push')}
        />
        <Input label="From" type="date" value={values.from} onChange={(event) => edit({ from: event.target.value })} />
        <Input label="To" type="date" value={values.to} onChange={(event) => edit({ to: event.target.value })} />
        <Button type="submit" className="sm:col-span-2 lg:col-span-1">Search</Button>
      </form>

      <section aria-labelledby={`${id}-results`} aria-busy={!current} className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={`${id}-results`} className="font-heading text-h4 font-semibold text-text-dark">
            {page ? `${total} ${total === 1 ? 'entry' : 'entries'}` : ACTIVITY_LOG_LABELS[log]}
          </h2>
          <p role="status" className="text-sm text-text-body">
            {!current ? 'Loading the log…' : page?.items.length ? `Showing ${first}–${first + page.items.length - 1} of ${total}` : ''}
          </p>
        </div>
        {!current ? (
          <ul aria-hidden className="mt-4 space-y-3">
            {[0, 1, 2].map((index) => <li key={index} className="h-16 animate-pulse rounded-xl border border-border bg-white" />)}
          </ul>
        ) : !page ? (
          <LoadErrorCard title="Couldn't load the activity log" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
        ) : page.items.length === 0 ? (
          <Card className="mt-4 flex flex-col items-start gap-3 p-6">
            <h3 className="font-heading text-h4 font-semibold">{total ? 'No entries on this page' : 'No entries found'}</h3>
            <p className="text-sm text-text-body">
              {total ? 'This log has fewer pages.' : filtered ? 'Try another person, action, kind or dates.' : 'Nothing has been recorded in this log yet.'}
            </p>
            {filtered || total ? (
              <Button
                variant="secondary"
                onClick={() => setSearchParams({ actor: null, action: null, entity: null, from: null, to: null, page: null }, 'push')}
              >
                Clear the filters
              </Button>
            ) : null}
          </Card>
        ) : (
          <>
            <ol className="mt-4 divide-y divide-border rounded-2xl border border-border bg-white">
              {page.items.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
            </ol>
            <ProfilePagination
              page={pageNumber}
              totalPages={Math.ceil(total / ACTIVITY_PAGE_SIZE)}
              hrefFor={(number) => activityFiltersHref({ ...filters, page: number })}
            />
          </>
        )}
      </section>
    </div>
  );
}

function EntryRow({ entry }: { entry: ActivityEntry }) {
  const details = Object.entries(entry.details).filter(([detailKey]) => detailKey !== 'source');
  const who = entry.actor
    ? `${entry.actor.full_name ?? 'An account'}${entry.actor.role ? ` (${ROLE_LABELS[entry.actor.role] ?? entry.actor.role})` : ''}`
    : 'TenantVoice';
  return (
    <li className="flex flex-col gap-1 p-4">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-text-dark">{who}</span>
        <span className="break-all font-mono text-xs text-text-body">{entry.action}</span>
        <time dateTime={entry.created_at} className="text-text-body">{messageTimestamp(entry.created_at)}</time>
      </p>
      {entry.summary ? <p className="break-words text-sm text-text-dark">{entry.summary}</p> : null}
      {entry.entity_type ? (
        <p className="break-all text-xs text-text-body">
          {ENTITY_NOUNS[entry.entity_type] ?? entry.entity_type}{entry.entity_id ? ` ${entry.entity_id}` : ''}
        </p>
      ) : null}
      {details.length ? (
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {details.map(([detailKey, value]) => (
            <div key={detailKey} className="flex min-w-0 gap-1">
              <dt className="text-text-body">{detailKey.replace(/_/g, ' ')}:</dt>
              <dd className="break-words text-text-dark">{value === null ? '—' : String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
