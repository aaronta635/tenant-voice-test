'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import BrandLogo from '@/app/components/BrandLogo';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import Input from '@/app/components/ui/Input';
import {
  api,
  ApiError,
  safe,
  type ApplicationStatus as BackendApplicationStatus,
  type NotificationItem,
  type Profile,
} from '@/app/lib/api';
import { relativeTime } from '@/app/lib/format';

const FALLBACK_IMAGE = '/tenant/application-modern-loft.png';

type ApplicationStatus = 'Approved' | 'Pending' | 'Rejected';

type Application = {
  id: string;
  propertyId: string;
  title: string;
  address: string;
  submitted: string;
  status: ApplicationStatus;
  image: string;
};

function mapStatus(status: BackendApplicationStatus): ApplicationStatus {
  if (status === 'approved') return 'Approved';
  if (status === 'declined') return 'Rejected';
  return 'Pending';
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const navItems = [
  { label: 'Dashboard', href: '/tenant/dashboard' },
  { label: 'Ratings & Reviews', href: '/tenant/write-review' },
  { label: 'Properties', href: '/tenant/properties' },
  { label: 'Applications', href: '/tenant/applications' },
  { label: 'Connections', href: '/tenant/network' },
  { label: 'Messages', href: '/tenant/messages' },
];

export default function TenantApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [activity, setActivity] = useState<NotificationItem[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  async function loadApplications() {
    setLoading(true);
    setError(null);
    try {
      const apps = await api.applications.listMine();
      const enriched = await Promise.all(
        apps.map(async (app): Promise<Application> => {
          let title = `Property ${app.property_id}`;
          let address = `Property ${app.property_id}`;
          let image = FALLBACK_IMAGE;
          try {
            const property = await api.properties.getPublic(app.property_id);
            title = property.title;
            address = property.address;
            image = property.photo_urls?.[0] || FALLBACK_IMAGE;
          } catch {
            // Property may be off-market or removed; keep the fallback text.
          }
          return {
            id: app.id,
            propertyId: app.property_id,
            title,
            address,
            submitted: formatDate(app.created_at),
            status: mapStatus(app.status),
            image,
          };
        }),
      );
      setApplications(enriched);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load applications right now.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadApplications();
    safe(api.notifications.list(false, 3), []).then(setActivity);
    safe<Profile | null>(api.profiles.me(), null).then(setProfile);
  }, []);

  async function handleWithdraw(id: string) {
    setWithdrawingId(id);
    try {
      await api.applications.withdraw(id);
      await loadApplications();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to withdraw this application right now.');
    } finally {
      setWithdrawingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-[#171a1f]">
      <TenantTopNav />

      <main className="mx-auto grid w-full max-w-[1440px] gap-8 px-6 py-8 lg:grid-cols-[minmax(0,964px)_380px] lg:px-8">
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
                <Button variant="secondary" className="h-11 rounded-[6px] px-6">
                  View Rental Pipeline
                </Button>
              </Link>
              <Link href="/tenant/properties">
                <Button className="h-11 rounded-[6px] px-8 shadow-[0_2px_5px_rgba(23,26,31,0.09)]">
                  <span className="text-base leading-none">+</span>
                  Start New Application
                </Button>
              </Link>
            </div>
          </div>

          <div className="mt-8">
            <Input
              aria-label="Search applications"
              placeholder="Search applications by title, address, or ID..."
              leadingIcon={<SearchIcon className="size-5" />}
              className="h-12 rounded-[6px] bg-white"
            />
          </div>

          <div className="mt-8 flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#171a1f]">Recent Applications</h2>
            <span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-medium text-[#565d6d]">
              {applications.length} Total
            </span>
          </div>

          <div className="mt-4 space-y-6">
            {loading ? (
              <Card className="rounded-[16px] border border-[#f3f4f6] p-8 text-center">
                <p className="text-sm font-medium text-[#565d6d]">Loading your applications…</p>
              </Card>
            ) : error ? (
              <Card className="rounded-[16px] border border-[#f3f4f6] p-8 text-center">
                <p className="text-sm font-medium text-[#de3b40]">{error}</p>
                <Button variant="secondary" className="mt-4 h-10 rounded-[6px]" onClick={loadApplications}>
                  Try again
                </Button>
              </Card>
            ) : applications.length === 0 ? (
              <Card className="rounded-[16px] border border-[#f3f4f6] p-8 text-center">
                <p className="text-sm font-medium text-[#171a1f]">You haven&apos;t applied to any properties yet.</p>
                <Link href="/tenant/properties" className="mt-4 inline-block">
                  <Button className="h-10 rounded-[6px]">Browse properties</Button>
                </Link>
              </Card>
            ) : (
              applications.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  onWithdraw={handleWithdraw}
                  withdrawing={withdrawingId === application.id}
                />
              ))
            )}
          </div>
        </section>

        <aside className="space-y-6 lg:pt-3">
          <QuickActions />
          <FilterPanel applications={applications} />
          <RecentActivity items={activity} />
          <ProfileCompletion profile={profile} />
        </aside>
      </main>
    </div>
  );
}

function TenantTopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-[#f3f4f6] bg-white">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-6 lg:px-8">
        <div className="w-[200px] shrink-0">
          <BrandLogo href="/tenant/dashboard" size="sm" />
        </div>
        <nav className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
          {navItems.map((item) => {
            const active = item.label === 'Applications';
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`rounded-[4px] px-4 py-2 text-xs font-medium ${
                  active
                    ? 'bg-[#f0f1ff] text-primary'
                    : 'text-[#565d6d] hover:bg-[#fafafe] hover:text-[#171a1f]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <label className="relative hidden w-[260px] items-center md:flex">
            <SearchIcon className="pointer-events-none absolute left-3 size-4 text-[#8c97a2]" />
            <input
              aria-label="Search"
              placeholder="Search..."
              className="h-10 w-full rounded-[4px] border border-transparent bg-[#f8f8fa] pl-9 pr-3 text-sm text-[#171a1f] outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <button
            type="button"
            aria-label="Notifications"
            className="relative flex size-9 items-center justify-center rounded-[4px] text-[#565d6d] hover:bg-[#f8f8fa]"
          >
            <BellIcon className="size-5" />
            <span className="absolute right-2 top-2 size-2 rounded-full bg-[#de3b40]" />
          </button>
          <button
            type="button"
            aria-label="Account menu"
            className="size-8 rounded-full bg-[#d9d9d9]"
          />
        </div>
      </div>
    </header>
  );
}

function ApplicationCard({
  application,
  onWithdraw,
  withdrawing,
}: {
  application: Application;
  onWithdraw: (id: string) => void;
  withdrawing: boolean;
}) {
  return (
    <Card className="overflow-hidden rounded-[16px] border border-[#f3f4f6]">
      <div className="relative h-[220px] w-full sm:h-[300px] lg:h-[385px]">
        <Image
          src={application.image}
          alt=""
          fill
          sizes="(min-width: 1024px) 964px, 100vw"
          className="object-cover"
        />
      </div>

      <div className="p-6">
        <h3 className="font-heading text-xl font-bold leading-7 tracking-tight text-[#171a1f]">
          {application.title}
        </h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-[#565d6d]">
          <PinIcon className="size-4 shrink-0" />
          <span>{application.address}</span>
        </p>

        <div className="mt-5 grid gap-4 rounded-[10px] border border-[#f3f4f6]/70 bg-[#f3f4f6]/40 px-4 py-3 sm:grid-cols-2">
          <MetaItem label="# App ID" value={application.id} />
          <MetaItem
            icon={<CalendarIcon className="size-4" />}
            label="Submitted"
            value={application.submitted}
          />
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-[#565d6d]">Current Status</p>
          <StatusPill status={application.status} />
        </div>

        <div className="mt-5 flex justify-end gap-3 border-t border-[#f3f4f6] pt-5">
          <button
            type="button"
            onClick={() => onWithdraw(application.id)}
            disabled={withdrawing}
            className="h-10 rounded-[6px] px-4 text-sm font-medium text-[#565d6d] hover:bg-[#f8f8fa] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {withdrawing ? 'Withdrawing…' : 'Withdraw'}
          </button>
          <Link
            href={`/tenant/properties/${application.propertyId}`}
            className="inline-flex h-10 items-center rounded-[6px] border border-primary/20 bg-white px-4 text-sm font-medium text-primary shadow-[0_2px_5px_rgba(23,26,31,0.09)] hover:bg-[#f8f8ff]"
          >
            View Property
          </Link>
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
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.6px] text-[#565d6d]">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-[#171a1f]">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: ApplicationStatus }) {
  const styles: Record<ApplicationStatus, string> = {
    Approved: 'bg-primary text-white',
    Pending: 'bg-[#f3f4f6] text-[#565d6d]',
    Rejected: 'bg-[#de3b40] text-white',
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${styles[status]}`}>
      {status === 'Approved' ? <CheckIcon className="size-3" /> : null}
      {status === 'Pending' ? <ClockIcon className="size-3" /> : null}
      {status === 'Rejected' ? <XIcon className="size-3" /> : null}
      {status}
    </span>
  );
}

function QuickActions() {
  return (
    <Card className="rounded-[10px] border border-[#f3f4f6] p-5">
      <h2 className="text-base font-bold text-[#171a1f]">Quick Actions</h2>
      <div className="mt-4 space-y-3">
        <Link href="/tenant/pipeline" className="block">
          <Button fullWidth className="h-12 rounded-[4px] bg-[#f0f1ff] text-primary shadow-none hover:bg-[#e7e9ff]">
            View Rental Pipeline
          </Button>
        </Link>
        <Link href="/tenant/properties" className="block">
          <Button variant="ghost" fullWidth className="h-12 rounded-[4px] bg-white text-[#171a1f]">
            <SearchIcon className="size-4" />
            Find Properties
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function FilterPanel({ applications }: { applications: Application[] }) {
  const actionRequired = applications.filter((a) => a.status === 'Pending').length;
  return (
    <Card className="rounded-[10px] border border-[#f3f4f6] p-6">
      <div className="text-center">
        <FilterIcon className="mx-auto size-5 text-[#565d6d]" />
        <h2 className="mt-2 text-base font-bold text-[#171a1f]">Filter & Summaries</h2>
      </div>

      <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.6px] text-[#565d6d]">
        Overview
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <SummaryTile value={String(applications.length)} label="Total Apps" />
        <SummaryTile value={String(actionRequired)} label="Action Req." highlighted />
      </div>

      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.6px] text-[#565d6d]">
        Status
      </p>
      <div className="mt-3 space-y-2 text-sm text-[#171a1f]">
        {['Approved', 'Pending', 'Rejected'].map((status) => (
          <label key={status} className="flex items-center gap-2">
            <input type="checkbox" defaultChecked className="size-4 accent-[#636ae8]" />
            {status}
          </label>
        ))}
      </div>

      <Input
        label="Submission Date"
        labelClassName="mt-6"
        aria-label="Submission date"
        className="h-10 rounded-[4px] bg-white"
      />

      <Button variant="secondary" fullWidth className="mt-6 h-10 rounded-[4px] border-[#e5e7eb] text-[#171a1f]">
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
    <div className={`rounded-[6px] border border-[#f3f4f6] p-4 text-center ${highlighted ? 'bg-[#f0f1ff]' : 'bg-[#fafafa]'}`}>
      <p className={`text-3xl font-semibold ${highlighted ? 'text-primary' : 'text-[#171a1f]'}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-[#565d6d]">{label}</p>
    </div>
  );
}

function RecentActivity({ items }: { items: NotificationItem[] }) {
  const iconFor = (category: NotificationItem['category']) => {
    if (category === 'message') return <MessageIcon className="size-4" />;
    if (category === 'review') return <StarIcon className="size-4" />;
    return <ActivityIcon className="size-4" />;
  };

  return (
    <Card className="rounded-[10px] border border-[#f3f4f6]">
      <div className="flex items-center justify-between border-b border-[#f3f4f6] px-6 py-5">
        <h2 className="text-base font-bold text-[#171a1f]">Recent Activity</h2>
        <Link href="/tenant/notifications" className="text-sm font-medium text-primary">
          View All
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="px-6 py-5 text-sm text-[#565d6d]">No activity yet.</p>
      ) : (
        <ul>
          {items.map((item, index) => (
            <li
              key={item.id}
              className={`flex gap-4 px-6 py-5 ${index < items.length - 1 ? 'border-b border-[#f3f4f6]' : ''}`}
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f0f1ff] text-primary">
                {iconFor(item.category)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-5 text-[#171a1f]">{item.title}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-[#565d6d]">
                  <ClockIcon className="size-3" />
                  {relativeTime(item.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProfileCompletion({ profile }: { profile: Profile | null }) {
  const checks = [
    !!profile?.full_name,
    !!profile?.email,
    !!profile?.phone,
    !!profile?.location,
    !!profile?.state,
    !!profile?.avatar_url,
  ];
  const completion = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  return (
    <Card className="relative overflow-hidden rounded-[10px] border border-[#f3f4f6] p-6">
      <SquareCheckIcon className="absolute right-6 top-4 size-20 text-[#f0f1ff]" />
      <h2 className="relative text-base font-bold text-[#171a1f]">Profile Completion</h2>
      <div className="relative mt-7 h-2.5 rounded-full bg-[#e5e7eb]">
        <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
      </div>
      <div className="relative mt-4 flex items-center justify-between text-sm">
        <span className="font-medium text-[#171a1f]">{completion}% Complete</span>
        <Link href="/tenant/personal-information" className="font-medium text-primary">
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

function BellIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
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

function FilterIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z" />
    </svg>
  );
}

function MessageIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.5-4A8 8 0 1 1 21 12Z" />
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

function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
    </svg>
  );
}

function SquareCheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}
