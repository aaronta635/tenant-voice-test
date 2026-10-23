'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AccountStatusBadge from '@/app/components/admin/AccountStatusBadge';
import UserStatusDialog, { type StatusTarget } from '@/app/components/admin/UserStatusDialog';
import ProfilePagination from '@/app/components/public-profiles/ProfilePagination';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import {
  ACCOUNT_STATUS_LABELS,
  ADMIN_PAGE_SIZE,
  adminApi,
  parseUserFilters,
  ROLE_FILTER_LABELS,
  ROLE_LABELS,
  userFiltersHref,
  type AccountStatus,
  type AdminRoleFilter,
  type AdminUser,
  type AdminUserDetail,
  type AdminUserPage,
} from '@/app/lib/admin-api';
import { ApiError } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';
import { focusResult } from '@/app/lib/focus-result';
import { setSearchParams } from '@/app/lib/page-url';

// Staff accounts are the TenantVoice team's to manage (the server refuses them too).
const STAFF_ROLES = new Set(['admin', 'officer']);

type Result = { key: string; page: AdminUserPage | null; error: string | null };

/**
 * GET /admin/users with its filters in the URL (role, status, q, page), so
 * Back and a shared link keep the view; every change goes through the
 * History API (lib/page-url). Each member's status changes from a dialog
 * that needs a reason.
 */
export default function AdminUsers() {
  const id = useId();
  const params = useSearchParams();
  const filters = parseUserFilters(params);
  const { role, status, q, page: pageNumber } = filters;
  const [draft, setDraft] = useState({ q: filters.q, seen: filters.q });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [target, setTarget] = useState<StatusTarget | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  const listRef = useRef<HTMLElement>(null);
  const changedRef = useRef<HTMLDivElement>(null);
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
    adminApi.users({ role, status, q, page: pageNumber }).then(
      (found) => { if (active) setResult({ key, page: found, error: null }); },
      (error) => { if (active) setResult({ key, page: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [key, role, status, q, pageNumber]);

  useEffect(() => { if (changed) focusResult(changedRef.current, listRef.current); }, [changed]);

  function onChanged(user: AdminUserDetail) {
    setTarget(null);
    setChanged(`${user.full_name || user.email} is now ${ACCOUNT_STATUS_LABELS[user.status].toLowerCase()}.`);
    setResult((previous) => previous?.page
      ? { ...previous, page: { ...previous.page, items: previous.page.items.map((item) => (item.id === user.id ? { ...item, status: user.status } : item)) } }
      : previous);
  }

  const page = current?.page;
  const total = page?.total ?? 0;
  const first = (filters.page - 1) * ADMIN_PAGE_SIZE + 1;
  const filtered = Boolean(filters.role || filters.status || filters.q);

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
      <PageHeader title="Users" description="Every open TenantVoice account. Closed accounts are counted on the overview." />

      <form
        role="search"
        aria-label="Users"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
        onSubmit={(event) => { event.preventDefault(); setSearchParams({ q: query.trim() || null, page: null }, 'push'); }}
      >
        <Input
          label="Name or email"
          type="search"
          maxLength={100}
          value={query}
          onChange={(event) => setDraft({ q: event.target.value, seen: filters.q })}
        />
        <FilterSelect
          label="Role"
          value={filters.role}
          options={Object.entries(ROLE_FILTER_LABELS) as [AdminRoleFilter, string][]}
          onChange={(role) => setSearchParams({ role: role || null, page: null }, 'push')}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          options={Object.entries(ACCOUNT_STATUS_LABELS) as [AccountStatus, string][]}
          onChange={(status) => setSearchParams({ status: status || null, page: null }, 'push')}
        />
        <Button type="submit" className="sm:col-span-2 lg:col-span-1">Search</Button>
      </form>

      <div ref={changedRef} tabIndex={-1}>
        <FormMessage success={changed} />
      </div>

      <section ref={listRef} aria-labelledby={`${id}-results`} aria-busy={!current} className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={`${id}-results`} className="font-heading text-h4 font-semibold text-text-dark">
            {page ? `${total} ${total === 1 ? 'account' : 'accounts'}` : 'Accounts'}
          </h2>
          <p role="status" className="text-sm text-text-body">
            {!current ? 'Loading accounts…' : page?.items.length ? `Showing ${first}–${first + page.items.length - 1} of ${total}` : ''}
          </p>
        </div>
        {!current ? (
          <ul aria-hidden className="mt-4 space-y-3">
            {[0, 1, 2].map((index) => <li key={index} className="h-20 animate-pulse rounded-xl border border-border bg-white" />)}
          </ul>
        ) : !page ? (
          <LoadErrorCard title="Couldn't load the accounts" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
        ) : page.items.length === 0 ? (
          <Card className="mt-4 flex flex-col items-start gap-3 p-6">
            <h3 className="font-heading text-h4 font-semibold">{total ? 'No accounts on this page' : 'No accounts found'}</h3>
            <p className="text-sm text-text-body">
              {total ? 'This search has fewer pages.' : filtered ? 'Try another name, email, role or status.' : 'Nobody has an account yet.'}
            </p>
            {filtered || total ? (
              <Button variant="secondary" onClick={() => setSearchParams({ role: null, status: null, q: null, page: null }, 'push')}>
                Clear the filters
              </Button>
            ) : null}
          </Card>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-white">
              {page.items.map((user) => (
                <UserRow key={user.id} user={user} onChangeStatus={() => setTarget(user)} />
              ))}
            </ul>
            <ProfilePagination
              page={filters.page}
              totalPages={Math.ceil(total / ADMIN_PAGE_SIZE)}
              hrefFor={(number) => userFiltersHref({ ...filters, page: number })}
            />
          </>
        )}
      </section>

      <UserStatusDialog
        key={target?.id ?? 'none'}
        user={target}
        onClose={() => setTarget(null)}
        onChanged={onChanged}
        returnFocus={() => changedRef.current}
      />
    </div>
  );
}

function UserRow({ user, onChangeStatus }: { user: AdminUser; onChangeStatus: () => void }) {
  const name = user.full_name || user.email || 'Unnamed account';
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link href={`/admin/users/${encodeURIComponent(user.id)}`} className="font-semibold text-primary-strong underline">
          {name}
        </Link>
        <p className="break-all text-sm text-text-body">{user.email}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-body">
          <span>{ROLE_LABELS[user.role] ?? user.role}</span>
          <AccountStatusBadge status={user.status} />
          {user.pending_documents ? <span>{user.pending_documents} in review</span> : null}
          {user.created_at ? <span>Joined {formatDate(user.created_at)}</span> : null}
        </p>
      </div>
      {STAFF_ROLES.has(user.role) ? (
        <p className="text-sm text-text-body">Staff account</p>
      ) : (
        <Button variant="secondary" size="sm" className="shrink-0" onClick={onChangeStatus}>
          Change status<span className="sr-only"> of {name}</span>
        </Button>
      )}
    </li>
  );
}

function FilterSelect<T extends string>({ label, value, options, onChange }: {
  label: string; value: T | ''; options: [T, string][]; onChange: (value: T | '') => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T | '')}
        className="min-h-11 w-full min-w-0 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
      >
        <option value="">All</option>
        {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
      </select>
    </div>
  );
}
