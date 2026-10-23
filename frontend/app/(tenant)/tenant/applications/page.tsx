'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ApplicationHistory from '@/app/components/rental/ApplicationHistory';
import NoPhotoYet from '@/app/components/rental/NoPhotoYet';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import Input from '@/app/components/ui/Input';
import TenantShell from '@/app/components/tenant/TenantShell';
import {
  api,
  ApiError,
  safe,
  type Application,
  type ApplicationStage,
  type NotificationItem,
  type Profile,
} from '@/app/lib/api';
import { formatDate, formatMoney, relativeTime } from '@/app/lib/format';
import { listingPhoto } from '@/app/lib/listing-photo';
import { APPLICATION_STAGE_LABELS, canWithdraw, decisionNote, stageOf } from '@/app/lib/listings';
import { completionScore } from '@/app/lib/my-profile';
import { isRemoteImage } from '@/app/lib/remote-image';

// The status filters, each a group of stages.
type Group = 'waiting' | 'approved' | 'declined' | 'closed';
const GROUPS: { value: Group; label: string; stages: ApplicationStage[] }[] = [
  { value: 'waiting', label: 'Waiting on the landlord', stages: ['submitted', 'under_review', 'shortlisted'] },
  { value: 'approved', label: 'Approved', stages: ['approved'] },
  { value: 'declined', label: 'Declined', stages: ['declined'] },
  { value: 'closed', label: 'Withdrawn or expired', stages: ['withdrawn', 'expired'] },
];
const ALL_GROUPS = GROUPS.map((group) => group.value);

function groupOf(stage: ApplicationStage): Group {
  return GROUPS.find((group) => group.stages.includes(stage))?.value ?? 'waiting';
}

function placeOf(application: Application): string {
  const listing = application.listing;
  return listing ? [listing.suburb, listing.state].filter(Boolean).join(', ') : '';
}

export default function TenantApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [activity, setActivity] = useState<NotificationItem[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<{ id: string; message: string } | null>(null);
  const [search, setSearch] = useState('');
  const [groups, setGroups] = useState<Group[]>(ALL_GROUPS);

  function loadApplications() {
    // Each application names its listing (title, suburb, photo), even one no longer advertised.
    return api.applications
      .listMine()
      .then((apps) => {
        setApplications(apps);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load applications right now.');
      })
      .finally(() => {
        setLoading(false);
      });
  }

  useEffect(() => {
    loadApplications();
    safe(api.notifications.list(false, 3), []).then(setActivity);
    safe<Profile | null>(api.profiles.me(), null).then(setProfile);
  }, []);

  function retryLoad() {
    setLoading(true);
    setError(null);
    void loadApplications();
  }

  async function handleWithdraw(id: string) {
    setWithdrawingId(id);
    setWithdrawError(null);
    try {
      await api.applications.withdraw(id);
      await loadApplications();
    } catch (err) {
      // Said on its card, so the other applications stay in view.
      setWithdrawError({
        id,
        message: err instanceof ApiError ? err.message : 'Unable to withdraw this application right now.',
      });
      // The landlord may have decided it meanwhile: show where it stands now.
      await loadApplications();
    } finally {
      setWithdrawingId(null);
    }
  }

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return applications.filter((application) => {
      if (!groups.includes(groupOf(stageOf(application)))) return false;
      if (!needle) return true;
      return [application.listing?.title, placeOf(application), application.id]
        .some((text) => (text ?? '').toLowerCase().includes(needle));
    });
  }, [applications, groups, search]);

  function toggleGroup(group: Group, on: boolean) {
    setGroups((current) => (on ? [...current, group] : current.filter((value) => value !== group)));
  }

  function resetFilters() {
    setSearch('');
    setGroups(ALL_GROUPS);
  }

  return (
    <TenantShell>
      <main className="mx-auto grid w-full max-w-[1240px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="font-heading text-[30px] font-semibold leading-9 tracking-tight text-[#171a1f]">
                My Applications
              </h1>
              <p className="mt-1 text-sm text-[#565d6d]">
                Manage and track the status of your property applications.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/tenant/pipeline">
                <Button variant="secondary" className="h-11 rounded-[10px] px-6">
                  View Rental Pipeline
                </Button>
              </Link>
              <Link href="/tenant/properties">
                <Button className="h-11 rounded-[10px] px-8">
                  <span className="text-base leading-none">+</span>
                  Start New Application
                </Button>
              </Link>
            </div>
          </div>

          <div className="mt-8">
            <Input
              aria-label="Search applications"
              placeholder="Search applications by title, suburb, or ID..."
              leadingIcon={<SearchIcon className="size-5" />}
              className="h-12 rounded-[10px] bg-white"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="mt-8 flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#171a1f]">Recent Applications</h2>
            <span className="rounded-full bg-[#f0f1ff] px-3 py-1 text-xs font-medium text-primary-strong">
              {applications.length} Total
            </span>
          </div>

          <div className="mt-4 space-y-6">
            {loading ? (
              <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center shadow-none">
                <p role="status" className="text-sm font-medium text-[#565d6d]">Loading your applications…</p>
              </Card>
            ) : error ? (
              <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center shadow-none">
                <p className="text-sm font-medium text-danger">{error}</p>
                <Button variant="secondary" className="mt-4 h-10 rounded-[8px]" onClick={retryLoad}>
                  Try again
                </Button>
              </Card>
            ) : applications.length === 0 ? (
              <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center shadow-none">
                <p className="text-sm font-medium text-[#171a1f]">
                  You haven&apos;t applied to any properties yet.
                </p>
                <Link href="/tenant/properties" className="mt-4 inline-block">
                  <Button className="h-10 rounded-[8px]">Browse properties</Button>
                </Link>
              </Card>
            ) : shown.length === 0 ? (
              <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center shadow-none">
                <p role="status" className="text-sm font-medium text-[#171a1f]">No applications match these filters.</p>
                <Button variant="secondary" className="mt-4 h-10 rounded-[8px]" onClick={resetFilters}>Reset Filters</Button>
              </Card>
            ) : (
              shown.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  onWithdraw={handleWithdraw}
                  withdrawing={withdrawingId === application.id}
                  withdrawError={withdrawError?.id === application.id ? withdrawError.message : null}
                />
              ))
            )}
          </div>
        </section>

        <aside className="min-w-0 space-y-6">
          <QuickActions />
          <FilterPanel applications={applications} groups={groups} onToggle={toggleGroup} onReset={resetFilters} />
          <RecentActivity items={activity} />
          <ProfileCompletion profile={profile} />
        </aside>
      </main>
    </TenantShell>
  );
}

function ApplicationCard({
  application,
  onWithdraw,
  withdrawing,
  withdrawError,
}: {
  application: Application;
  onWithdraw: (id: string) => void;
  withdrawing: boolean;
  withdrawError: string | null;
}) {
  const listing = application.listing ?? null;
  const photo = listingPhoto(listing?.photo_url ? [listing.photo_url] : null);
  const stage = stageOf(application);
  const note = decisionNote(application);
  const documents = application.documents ?? [];
  const title = listing?.title ?? 'A listing no longer on TenantVoice';
  const place = placeOf(application);
  return (
    <Card className="overflow-hidden rounded-[16px] border border-[#dee1e6] shadow-none">
      <div className="relative h-[220px] w-full sm:h-[280px]">
        {photo ? (
          <Image
            src={photo}
            alt=""
            fill
            sizes="(min-width: 1024px) 900px, 100vw"
            className="object-cover"
            unoptimized={isRemoteImage(photo)}
          />
        ) : (
          <NoPhotoYet />
        )}
      </div>

      <div className="p-6">
        <h3 className="break-words font-heading text-xl font-bold leading-7 tracking-tight text-[#171a1f]">
          {title}
        </h3>
        {place ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-[#565d6d]">
            <PinIcon className="size-4 shrink-0" />
            <span>{place}</span>
          </p>
        ) : null}

        <div className="mt-5 grid gap-4 rounded-[12px] border border-[#eef0f4] bg-[#fafbfc] px-4 py-3 sm:grid-cols-2">
          <MetaItem label="# App ID" value={application.id} />
          <MetaItem icon={<CalendarIcon className="size-4" />} label="Submitted" value={formatDate(application.created_at)} />
          <MetaItem label="Your offer" value={application.rent_offered != null ? `${formatMoney(application.rent_offered)} a week` : '—'} />
          <MetaItem label="Move-in date" value={application.move_in_date ? formatDate(application.move_in_date) : 'Not given'} />
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-[#565d6d]">Current Status</p>
          <StatusPill stage={stage} />
        </div>

        {note ? (
          <div className="mt-4 rounded-[12px] border-l-2 border-primary bg-surface p-3">
            <p className="text-xs font-semibold text-[#171a1f]">From the landlord</p>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-[#171a1f]">{note}</p>
          </div>
        ) : null}

        {documents.length ? (
          <p className="mt-4 text-sm text-[#565d6d]">
            Documents shared:{' '}
            {documents.map((doc, index) => (
              <span key={doc.id}>
                {index ? ', ' : ''}
                <span className="text-[#171a1f]">{doc.label}</span>
                {doc.shared ? '' : ' (no longer shared)'}
              </span>
            ))}
          </p>
        ) : null}

        {application.history?.length ? (
          <details className="mt-4">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary-strong">
              Status history
            </summary>
            <div className="mt-2">
              <ApplicationHistory history={application.history} viewer="applicant" />
            </div>
          </details>
        ) : null}

        {withdrawError ? (
          <p role="alert" className="mt-4 text-sm font-medium text-danger">
            {withdrawError}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-[#eef0f4] pt-5">
          {/* Only an application the landlord has not decided can be withdrawn; the API refuses the rest. */}
          {canWithdraw(application) ? (
            <button
              type="button"
              onClick={() => onWithdraw(application.id)}
              disabled={withdrawing}
              className="h-10 rounded-[8px] px-4 text-sm font-medium text-[#565d6d] hover:bg-[#f8f9fa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {withdrawing ? 'Withdrawing…' : 'Withdraw'}
            </button>
          ) : null}
          {listing?.is_public ? (
            <Link
              href={`/tenant/properties/${application.property_id}`}
              className="inline-flex h-10 items-center rounded-[8px] border border-primary/20 bg-white px-4 text-sm font-medium text-primary-strong hover:bg-[#f8f8ff]"
            >
              View Property
            </Link>
          ) : (
            <p className="inline-flex h-10 items-center text-sm text-[#565d6d]">This listing is no longer advertised.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function MetaItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.6px] text-[#565d6d]">
        {icon}
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-medium text-[#171a1f]">{value}</p>
    </div>
  );
}

function StatusPill({ stage }: { stage: ApplicationStage }) {
  const group = groupOf(stage);
  const styles: Record<Group, string> = {
    waiting: 'bg-[#fff4e5] text-warning',
    approved: 'bg-primary-strong text-white',
    declined: 'bg-danger text-white',
    closed: 'bg-[#f3f4f6] text-[#565d6d]',
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${styles[group]}`}>
      {group === 'approved' ? <CheckIcon className="size-3" /> : null}
      {group === 'waiting' ? <ClockIcon className="size-3" /> : null}
      {group === 'declined' ? <XIcon className="size-3" /> : null}
      {APPLICATION_STAGE_LABELS[stage]}
    </span>
  );
}

function QuickActions() {
  return (
    <Card className="rounded-[16px] border border-[#dee1e6] p-5 shadow-none">
      <h2 className="text-sm font-bold text-[#171a1f]">Quick Actions</h2>
      <div className="mt-4 space-y-2">
        <Link href="/tenant/pipeline" className="block">
          <Button fullWidth className="h-10 rounded-[10px]">
            View Rental Pipeline
          </Button>
        </Link>
        <Link href="/tenant/properties" className="block">
          <Button variant="secondary" fullWidth className="h-10 rounded-[10px]">
            Find Properties
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function FilterPanel({
  applications,
  groups,
  onToggle,
  onReset,
}: {
  applications: Application[];
  groups: Group[];
  onToggle: (group: Group, on: boolean) => void;
  onReset: () => void;
}) {
  const waiting = applications.filter((application) => groupOf(stageOf(application)) === 'waiting').length;
  return (
    <Card className="rounded-[16px] border border-[#dee1e6] p-5 shadow-none">
      <h2 className="text-sm font-bold text-[#171a1f]">Filter & Summaries</h2>

      <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.6px] text-[#565d6d]">
        Overview
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <SummaryTile value={String(applications.length)} label="Total Apps" />
        <SummaryTile value={String(waiting)} label="Waiting" highlighted />
      </div>

      <fieldset className="mt-6">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.6px] text-[#565d6d]">Status</legend>
        <div className="mt-3 space-y-2 text-sm text-[#171a1f]">
          {GROUPS.map((group) => (
            <label key={group.value} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={groups.includes(group.value)}
                onChange={(event) => onToggle(group.value, event.target.checked)}
                className="size-4 accent-primary"
              />
              {group.label}
            </label>
          ))}
        </div>
      </fieldset>

      <Button variant="ghost" fullWidth className="mt-6 h-10 rounded-[8px] bg-[#f8f9fa]" onClick={onReset}>
        Reset Filters
      </Button>
    </Card>
  );
}

function SummaryTile({
  value,
  label,
  highlighted = false,
}: {
  value: string;
  label: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`rounded-[12px] border border-[#eef0f4] p-4 text-center ${
        highlighted ? 'bg-[#f0f1ff]' : 'bg-[#fafafa]'
      }`}
    >
      <p className={`text-2xl font-semibold ${highlighted ? 'text-primary-strong' : 'text-[#171a1f]'}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-[#565d6d]">{label}</p>
    </div>
  );
}

function RecentActivity({ items }: { items: NotificationItem[] }) {
  return (
    <Card className="rounded-[16px] border border-[#dee1e6] shadow-none">
      <div className="flex items-center justify-between border-b border-[#eef0f4] px-5 py-4">
        <h2 className="text-sm font-bold text-[#171a1f]">Recent Activity</h2>
        <Link href="/tenant/notifications" className="text-xs font-medium text-primary-strong underline">
          View All
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-5 text-sm text-[#565d6d]">No activity yet.</p>
      ) : (
        <ul>
          {items.map((item, index) => (
            <li
              key={item.id}
              className={`flex gap-3 px-5 py-4 ${
                index < items.length - 1 ? 'border-b border-[#eef0f4]' : ''
              }`}
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f0f1ff] text-primary">
                <ActivityIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-5 text-[#171a1f]">{item.title}</p>
                <p className="mt-1 text-xs text-[#565d6d]">{relativeTime(item.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProfileCompletion({ profile }: { profile: Profile | null }) {
  // Worked out by the server (GET /profiles/me), like on the completion page.
  const completion = completionScore(profile);

  return (
    <Card className="rounded-[16px] border border-[#dee1e6] p-5 shadow-none">
      <h2 className="text-sm font-bold text-[#171a1f]">Profile Completion</h2>
      <div className="mt-5 h-2.5 rounded-full bg-[#e5e7eb]">
        <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
      </div>
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="font-medium text-[#171a1f]">{completion}% Complete</span>
        <Link href="/tenant/profile-completion" className="font-medium text-primary-strong underline">
          Finish Setup ›
        </Link>
      </div>
    </Card>
  );
}

function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </svg>
  );
}

function PinIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M12 21s7-4.4 7-11a7 7 0 1 0-14 0c0 6.6 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M8 2v4M16 2v4M3.5 9h17M5 5h14a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6.5A1.5 1.5 0 0 1 5 5Z" />
    </svg>
  );
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className} aria-hidden>
      <path d="m5 12 4 4 10-10" />
    </svg>
  );
}

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function XIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function ActivityIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M22 12h-4l-3 8-6-16-3 8H2" />
    </svg>
  );
}
