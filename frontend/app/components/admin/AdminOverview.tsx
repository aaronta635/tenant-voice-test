'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import StatCard from '@/app/components/ui/StatCard';
import {
  adminApi,
  ROLE_FILTER_LABELS,
  userFiltersHref,
  type AdminOverview as Overview,
  type AdminRoleFilter,
} from '@/app/lib/admin-api';
import { ApiError } from '@/app/lib/api';

const COUNTS: { key: 'active' | 'pending_verification' | 'suspended' | 'deactivated'; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'pending_verification', label: 'Pending verification' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'deactivated', label: 'Deactivated' },
];

type Loaded = { attempt: number; overview: Overview | null; error: string | null };

/** Accounts by role and status, and the documents waiting for review, from GET /admin/overview. */
export default function AdminOverview() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = loaded?.attempt === attempt ? loaded : null;

  useEffect(() => {
    let active = true;
    adminApi.overview().then(
      (overview) => { if (active) setLoaded({ attempt, overview, error: null }); },
      (error) => { if (active) setLoaded({ attempt, overview: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [attempt]);

  const overview = current?.overview;
  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
      <PageHeader title="Overview" description="Accounts on TenantVoice and the documents waiting for review." />
      {!current ? (
        <div role="status" aria-label="Loading the overview" className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((index) => <div key={index} aria-hidden className="h-28 animate-pulse rounded-2xl border border-border bg-white" />)}
        </div>
      ) : !overview ? (
        <LoadErrorCard title="Couldn't load the overview" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Open accounts" value={String(overview.users_total)} />
            <StatCard
              label="Documents in review"
              value={String(overview.pending_documents)}
              hint={`From ${overview.pending_document_people} ${overview.pending_document_people === 1 ? 'person' : 'people'}`}
            />
            <StatCard label="Closed accounts" value={String(overview.closed_accounts)} hint="Archived; not listed under Users" />
          </div>
          <section aria-labelledby="admin-roles" className="min-w-0">
            <h2 id="admin-roles" className="font-heading text-h4 font-semibold text-text-dark">Accounts by role</h2>
            {overview.users_total === 0 ? (
              <p className="mt-3 text-sm text-text-body">There are no accounts yet.</p>
            ) : (
              <ul className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {overview.roles.map((role) => (
                  <li key={role.role}>
                    <Card className="flex h-full flex-col p-5">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="font-heading text-base font-semibold text-text-dark">
                          {ROLE_FILTER_LABELS[role.role as AdminRoleFilter] ?? role.role}
                        </h3>
                        <p className="text-2xl font-semibold text-text-dark">{role.total}</p>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        {COUNTS.map((count) => (
                          <div key={count.key} className="flex justify-between gap-2">
                            <dt className="text-text-body">{count.label}</dt>
                            <dd className="font-semibold text-text-dark">{role[count.key]}</dd>
                          </div>
                        ))}
                      </dl>
                      {role.total > 0 ? (
                        <Link
                          href={userFiltersHref({ role: role.role as AdminRoleFilter, status: '', q: '', page: 1 })}
                          className="mt-4 text-sm font-semibold text-primary-strong underline"
                        >
                          View {(ROLE_FILTER_LABELS[role.role as AdminRoleFilter] ?? role.role).toLowerCase()}
                        </Link>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-sm text-text-body">
            <Link href="/admin/verification" className="font-semibold text-primary-strong underline">Review documents in the verification queue</Link>
            {' '}to approve or reject them, by tenant, landlord or provider.
          </p>
        </>
      )}
    </div>
  );
}
