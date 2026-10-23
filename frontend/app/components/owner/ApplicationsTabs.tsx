'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import ApplicantCard from '@/app/components/owner/ApplicantCard';
import ApplicationSummaryCard from '@/app/components/owner/ApplicationSummaryCard';
import FilterApplicationsModal, {
  type StatusFilter,
} from '@/app/components/owner/FilterApplicationsModal';
import { FileTextIcon, LayoutDashboardIcon } from '@/app/components/owner/icons';
import { api, ApiError, type ApplicationStatus } from '@/app/lib/api';
import { propertyLabel, toApplicant } from '@/app/lib/owner-adapters';
import type { Applicant } from '@/app/lib/owner-data';

type SectionTab = 'applications' | 'summary';
type DashboardFilter = 'all' | 'shortlisted' | 'pending';

function matchesStatusFilter(applicant: Applicant, filters: StatusFilter[]) {
  if (filters.length === 0) return true;
  return filters.some((filter) => {
    if (filter === 'pending') return applicant.status === 'new' || applicant.status === 'reviewing';
    if (filter === 'accepted') return applicant.status === 'approved';
    if (filter === 'rejected') return applicant.status === 'declined';
    if (filter === 'shortlist') return applicant.shortlisted;
    return false;
  });
}

export default function ApplicationsTabs() {
  const [tab, setTab] = useState<SectionTab>('applications');
  const [modalOpen, setModalOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<StatusFilter[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<StatusFilter[]>([]);
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>('all');
  const [search, setSearch] = useState('');

  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Promise-chain style so every setState runs asynchronously — the effect
  // below stays cascade-free (react-hooks/set-state-in-effect). `loading`
  // starts true and `error` clears on success.
  const load = useCallback(
    () =>
      api.properties
        .listMine()
        .then(async (properties) => {
          const perProperty = await Promise.all(
            properties.map(async (property) => {
              const apps = await api.applications.listForProperty(property.id);
              return apps.map((app) => toApplicant(app, propertyLabel(property)));
            }),
          );
          setApplicants(perProperty.flat());
          setError(null);
        })
        .catch((err) => {
          setError(
            err instanceof ApiError
              ? err.message
              : 'Could not load applications. Is the API running?',
          );
        })
        .finally(() => {
          setLoading(false);
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function updateStatus(applicant: Applicant, status: ApplicationStatus) {
    if (pendingId) return;
    setPendingId(applicant.id);
    try {
      await api.applications.update(applicant.id, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the application.');
    } finally {
      setPendingId(null);
    }
  }

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return applicants;
    return applicants.filter(
      (a) =>
        a.name.toLowerCase().includes(q) || a.propertyLabel.toLowerCase().includes(q),
    );
  }, [applicants, search]);

  const visibleApplicants = useMemo(
    () => searched.filter((a) => matchesStatusFilter(a, appliedFilters)),
    [searched, appliedFilters],
  );

  const stats = useMemo(
    () => ({
      total: applicants.length,
      shortlist: applicants.filter((a) => a.shortlisted).length,
      accepted: applicants.filter((a) => a.status === 'approved').length,
      pending: applicants.filter((a) => a.status === 'new' || a.status === 'reviewing').length,
    }),
    [applicants],
  );

  const dashboardApplicants = useMemo(() => {
    if (dashboardFilter === 'shortlisted') return applicants.filter((a) => a.shortlisted);
    if (dashboardFilter === 'pending')
      return applicants.filter((a) => a.status === 'new' || a.status === 'reviewing');
    return applicants;
  }, [applicants, dashboardFilter]);

  function openModal() {
    setDraftFilters(appliedFilters);
    setModalOpen(true);
  }

  function handleApply() {
    setAppliedFilters(draftFilters);
    setModalOpen(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('applications')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium ${
            tab === 'applications'
              ? 'border-b-2 border-primary text-primary'
              : 'text-text-body hover:text-text-dark'
          }`}
        >
          <FileTextIcon size={16} />
          Applications
        </button>
        <button
          type="button"
          onClick={() => setTab('summary')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium ${
            tab === 'summary'
              ? 'border-b-2 border-primary text-primary'
              : 'text-text-body hover:text-text-dark'
          }`}
        >
          <LayoutDashboardIcon size={16} />
          Summary Dashboard
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-text-body">Loading applications…</p>
      ) : tab === 'applications' ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="font-heading text-2xl font-semibold text-text-dark">
              Recent Applications
            </h1>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search applications..."
                className="sm:w-[260px]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button variant="secondary" onClick={openModal}>
                All Statuses{appliedFilters.length > 0 ? ` (${appliedFilters.length})` : ''}
              </Button>
            </div>
          </div>

          {visibleApplicants.length === 0 ? (
            <p className="text-text-body">
              {applicants.length === 0
                ? 'No applications yet across your properties.'
                : 'No applications match the selected filters.'}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {visibleApplicants.map((applicant, index) => (
                <ApplicantCard
                  key={applicant.id}
                  applicant={applicant}
                  index={index}
                  busy={pendingId === applicant.id}
                  onAccept={(a) => updateStatus(a, 'approved')}
                  onReject={(a) => updateStatus(a, 'declined')}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-heading text-2xl font-bold text-text-dark">Applications</h1>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-2xl border border-border bg-white p-5 text-center shadow-sm">
              <p className="font-heading text-3xl font-semibold text-text-dark">{stats.total}</p>
              <p className="mt-1 text-xs font-medium tracking-wide text-text-body uppercase">
                Total
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-white p-5 text-center shadow-sm">
              <p className="font-heading text-3xl font-semibold text-[#c026d3]">
                {stats.shortlist}
              </p>
              <p className="mt-1 text-xs font-medium tracking-wide text-text-body uppercase">
                Shortlist
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-white p-5 text-center shadow-sm">
              <p className="font-heading text-3xl font-semibold text-[#059669]">
                {stats.accepted}
              </p>
              <p className="mt-1 text-xs font-medium tracking-wide text-text-body uppercase">
                Accepted
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-white p-5 text-center shadow-sm">
              <p className="font-heading text-3xl font-semibold text-[#f59e0b]">
                {stats.pending}
              </p>
              <p className="mt-1 text-xs font-medium tracking-wide text-text-body uppercase">
                Pending
              </p>
            </div>
          </div>

          <div className="flex w-fit gap-1 rounded-2xl bg-[#f3f4f6]/50 p-1.5">
            {(['all', 'shortlisted', 'pending'] as DashboardFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setDashboardFilter(filter)}
                className={`rounded-xl px-4 py-2 text-sm font-medium capitalize ${
                  dashboardFilter === filter
                    ? 'bg-white text-text-dark shadow-sm'
                    : 'text-text-body'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          {dashboardApplicants.length === 0 ? (
            <p className="text-text-body">No applicants in this filter.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {dashboardApplicants.map((applicant) => (
                <ApplicationSummaryCard key={applicant.id} applicant={applicant} />
              ))}
            </div>
          )}
        </div>
      )}

      {modalOpen ? (
        <FilterApplicationsModal
          selected={draftFilters}
          onChange={setDraftFilters}
          onApply={handleApply}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
