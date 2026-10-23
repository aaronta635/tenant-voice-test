'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AdminFilterSelect from '@/app/components/admin/AdminFilterSelect';
import ComplaintsSectionNav from '@/app/components/admin/ComplaintsSectionNav';
import ComplaintStatePill from '@/app/components/admin/ComplaintStatePill';
import ProfilePagination from '@/app/components/public-profiles/ProfilePagination';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import Input from '@/app/components/ui/Input';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import {
  adminComplaintsApi,
  COMPLAINT_PAGE_SIZE,
  COMPLAINT_STATUS_LABELS,
  complaintFiltersHref,
  parseComplaintFilters,
  SEVERITY_LABELS,
  type AdminComplaint,
  type AdminComplaintPage,
  type Assignee,
  type ComplaintStatus,
} from '@/app/lib/admin-complaints-api';
import { ApiError } from '@/app/lib/api';
import { complaintCategoriesApi } from '@/app/lib/complaint-categories';
import { formatDate } from '@/app/lib/format';
import { setSearchParams } from '@/app/lib/page-url';

type Result = { key: string; page: AdminComplaintPage | null; error: string | null };
type Choices = { categories: [string, string][]; assignees: Assignee[] };

/**
 * GET /admin/complaints with its filters in the URL (status, category,
 * assignee, q, page), so Back and a shared link keep the view; changes go
 * through the History API (lib/page-url). Each complaint opens its own page,
 * where its status changes and its assignment are made.
 */
export default function AdminComplaints() {
  const id = useId();
  const params = useSearchParams();
  const filters = parseComplaintFilters(params);
  const { status, category, assignee, q, page: pageNumber } = filters;
  const [draft, setDraft] = useState({ q: filters.q, seen: filters.q });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [choices, setChoices] = useState<Choices>({ categories: [], assignees: [] });
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
    adminComplaintsApi.list({ status, category, assignee, q, page: pageNumber }).then(
      (found) => { if (active) setResult({ key, page: found, error: null }); },
      (error) => { if (active) setResult({ key, page: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [key, status, category, assignee, q, pageNumber]);

  // The filters' choices: the fixed complaint categories, and the admins. Without them the filters offer "All" only.
  useEffect(() => {
    let active = true;
    Promise.allSettled([complaintCategoriesApi.list(), adminComplaintsApi.assignees()]).then(([categories, assignees]) => {
      if (!active) return;
      const listed = categories.status === 'fulfilled'
        ? categories.value.map((item): [string, string] => [item.code, item.name])
        : [];
      setChoices({ categories: listed, assignees: assignees.status === 'fulfilled' ? assignees.value : [] });
    });
    return () => { active = false; };
  }, []);

  const page = current?.page;
  const total = page?.total ?? 0;
  const first = (pageNumber - 1) * COMPLAINT_PAGE_SIZE + 1;
  const filtered = Boolean(status || category || assignee || q);
  const assigneeOptions: [string, string][] = [
    ['me', 'Assigned to me'],
    ['unassigned', 'Unassigned'],
    ...choices.assignees.map((person): [string, string] => [person.id, person.full_name]),
  ];
  if (assignee && !assigneeOptions.some(([value]) => value === assignee)) assigneeOptions.push([assignee, 'Another admin']);
  const categoryOptions = [...choices.categories];
  if (category && !categoryOptions.some(([value]) => value === category)) categoryOptions.push([category, category]);

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Complaints"
        description="Every complaint lodged on TenantVoice, newest first. Repairs are handled on the maintenance pages."
      />
      <ComplaintsSectionNav current="complaints" />

      <form
        role="search"
        aria-label="Complaints"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end"
        onSubmit={(event) => { event.preventDefault(); setSearchParams({ q: query.trim() || null, page: null }, 'push'); }}
      >
        <Input
          label="Subject or description"
          type="search"
          maxLength={100}
          value={query}
          onChange={(event) => setDraft({ q: event.target.value, seen: filters.q })}
        />
        <AdminFilterSelect
          label="Status"
          value={status}
          options={Object.entries(COMPLAINT_STATUS_LABELS) as [ComplaintStatus, string][]}
          onChange={(value) => setSearchParams({ status: value || null, page: null }, 'push')}
        />
        <AdminFilterSelect
          label="Category"
          value={category}
          options={categoryOptions}
          onChange={(value) => setSearchParams({ category: value || null, page: null }, 'push')}
        />
        <AdminFilterSelect
          label="Handled by"
          value={assignee}
          allLabel="Anyone"
          options={assigneeOptions}
          onChange={(value) => setSearchParams({ assignee: value || null, page: null }, 'push')}
        />
        <Button type="submit" className="sm:col-span-2 lg:col-span-1">Search</Button>
      </form>

      <section aria-labelledby={`${id}-results`} aria-busy={!current} className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={`${id}-results`} className="font-heading text-h4 font-semibold text-text-dark">
            {page ? `${total} ${total === 1 ? 'complaint' : 'complaints'}` : 'Complaints'}
          </h2>
          <p role="status" className="text-sm text-text-body">
            {!current ? 'Loading complaints…' : page?.items.length ? `Showing ${first}–${first + page.items.length - 1} of ${total}` : ''}
          </p>
        </div>
        {!current ? (
          <ul aria-hidden className="mt-4 space-y-3">
            {[0, 1, 2].map((index) => <li key={index} className="h-24 animate-pulse rounded-xl border border-border bg-white" />)}
          </ul>
        ) : !page ? (
          <LoadErrorCard title="Couldn't load the complaints" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
        ) : page.items.length === 0 ? (
          <Card className="mt-4 flex flex-col items-start gap-3 p-6">
            <h3 className="font-heading text-h4 font-semibold">{total ? 'No complaints on this page' : 'No complaints found'}</h3>
            <p className="text-sm text-text-body">
              {total ? 'This list has fewer pages.' : filtered ? 'Try another status, category, admin or search.' : 'Nobody has lodged a complaint yet.'}
            </p>
            {filtered || total ? (
              <Button variant="secondary" onClick={() => setSearchParams({ status: null, category: null, assignee: null, q: null, page: null }, 'push')}>
                Clear the filters
              </Button>
            ) : null}
          </Card>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-white">
              {page.items.map((complaint) => <ComplaintRow key={complaint.id} complaint={complaint} />)}
            </ul>
            <ProfilePagination
              page={pageNumber}
              totalPages={Math.ceil(total / COMPLAINT_PAGE_SIZE)}
              hrefFor={(number) => complaintFiltersHref({ ...filters, page: number })}
            />
          </>
        )}
      </section>
    </div>
  );
}

function ComplaintRow({ complaint }: { complaint: AdminComplaint }) {
  const about = complaint.property_title ?? complaint.against?.full_name ?? 'TenantVoice';
  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/complaints/${encodeURIComponent(complaint.id)}`} className="min-w-0 break-words font-semibold text-primary-strong underline">
          {complaint.subject}
        </Link>
        <ComplaintStatePill complaint={complaint} />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-body">
        <span>{complaint.category_label}{complaint.category_active ? '' : ' (older category)'}</span>
        {complaint.severity ? <span>{SEVERITY_LABELS[complaint.severity] ?? complaint.severity} severity</span> : null}
        <span>Lodged {formatDate(complaint.lodged_at)}</span>
        <span>{complaint.assignee ? `Handled by ${complaint.assignee.full_name ?? 'an admin'}` : 'Unassigned'}</span>
      </p>
      <p className="break-words text-sm text-text-body">
        {complaint.complainant.full_name ?? 'Someone'} about {about}
      </p>
    </li>
  );
}
