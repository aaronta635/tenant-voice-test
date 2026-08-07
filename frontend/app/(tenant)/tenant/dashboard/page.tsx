'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import TenantShell from '@/app/components/tenant/TenantShell';
import { api, safe, type NotificationItem, type Profile } from '@/app/lib/api';
import { relativeTime } from '@/app/lib/format';

// Route configuration for the dashboard tiles (navigation, not content).
const dashboardLinks = [
  {
    title: 'Ratings & Reviews',
    body: 'Write and submit rental reviews',
    href: '/tenant/write-review',
    tone: 'bg-[#fef3c7] text-[#d08700]',
    icon: <StarIcon className="size-6" />,
  },
  {
    title: 'Properties',
    body: 'Browse homes, rooms, prices, and photos',
    href: '/tenant/properties',
    tone: 'bg-[#dbeafe] text-[#2563eb]',
    icon: <HomeIcon className="size-6" />,
  },
  {
    title: 'Rental Applications',
    body: 'Track submitted rental applications',
    href: '/tenant/applications',
    tone: 'bg-[#dcfce7] text-[#16a34a]',
    icon: <FileIcon className="size-6" />,
  },
  {
    title: 'In-App Chat',
    body: 'Message owners about inspections',
    href: '/tenant/messages',
    tone: 'bg-[#f3e8ff] text-[#9333ea]',
    icon: <MessageIcon className="size-6" />,
  },
  {
    title: 'Search Profiles',
    body: 'Find owners, agents, and references',
    href: '/tenant/search-profile',
    tone: 'bg-[#ffedd5] text-[#f97316]',
    icon: <SearchIcon className="size-6" />,
  },
  {
    title: 'View Connections',
    body: 'See owners, agents, and references',
    href: '/tenant/network',
    tone: 'bg-[#ccfbf1] text-[#0d9488]',
    icon: <ConnectionsIcon className="size-6" />,
  },
  {
    title: 'Recommendations',
    body: 'Discover curated listings',
    href: '/tenant/recommendations',
    tone: 'bg-[#e0e7ff] text-[#636ae8]',
    icon: <BadgeStarIcon className="size-6" />,
  },
];

function completionFor(profile: Profile | null): number {
  if (!profile) return 0;
  const checks = [
    !!profile.full_name,
    !!profile.email,
    !!profile.phone,
    !!profile.location,
    !!profile.state,
    !!profile.avatar_url,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export default function TenantDashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activity, setActivity] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const [me, feed] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe(api.notifications.list(false, 5), []),
      ]);
      if (!active) return;
      setProfile(me);
      setActivity(feed);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const completion = completionFor(profile);
  const firstName = profile?.full_name?.split(' ')[0];

  return (
    <TenantShell>
      <main className="mx-auto grid w-full max-w-[1240px] gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 space-y-8">
          <Card className="rounded-[16px] border border-[#f1f5f9] bg-[rgba(248,250,252,0.8)] px-8 py-8">
            <h1 className="font-heading text-2xl font-bold leading-8 text-[#171a1f]">
              Welcome back{firstName ? `, ${firstName}` : ''}!
            </h1>
            <p className="mt-2 text-sm text-[#565d6d]">
              Streamline your rental journey with ease.
            </p>
          </Card>

          <div>
            <h2 className="font-heading text-lg font-semibold text-[#171a1f]">Your Dashboard</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {dashboardLinks.map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  className="group flex h-[90px] items-center rounded-[16px] border border-[#dee1e6] bg-white px-5 transition hover:border-primary/40 hover:shadow-[0_6px_18px_rgba(23,26,31,0.08)]"
                >
                  <span
                    className={`flex size-12 shrink-0 items-center justify-center rounded-[16px] ${item.tone}`}
                  >
                    {item.icon}
                  </span>
                  <span className="ml-4 min-w-0 flex-1">
                    <span className="block text-sm font-bold text-[#171a1f]">{item.title}</span>
                    <span className="mt-1 block truncate text-xs text-[#565d6d]">{item.body}</span>
                  </span>
                  <ChevronIcon className="ml-3 size-4 shrink-0 text-[#8c97a2] transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <Card className="rounded-[16px] border border-[#dee1e6] p-6">
            <h2 className="text-base font-bold text-[#171a1f]">Quick Actions</h2>
            <div className="mt-4 space-y-3">
              <Link href="/tenant/network" className="block">
                <Button
                  fullWidth
                  className="h-12 rounded-[12px] bg-[#f0f1ff] text-primary shadow-none hover:bg-[#e7e9ff]"
                >
                  <ConnectionsIcon className="size-4" />
                  View Connections
                </Button>
              </Link>
              <Link href="/tenant/properties" className="block">
                <Button
                  variant="ghost"
                  fullWidth
                  className="h-12 rounded-[12px] bg-[#f8f9fa] text-[#171a1f]"
                >
                  <SearchIcon className="size-4" />
                  Find Properties
                </Button>
              </Link>
            </div>
          </Card>

          <Card className="rounded-[16px] border border-[#dee1e6] p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#171a1f]">Recent Activity</h2>
              <Link href="/tenant/notifications" className="text-xs font-medium text-primary">
                View All
              </Link>
            </div>
            {loading ? (
              <p className="mt-5 text-sm text-[#565d6d]">Loading…</p>
            ) : activity.length === 0 ? (
              <p className="mt-5 text-sm text-[#565d6d]">No activity yet.</p>
            ) : (
              <ul className="mt-5">
                {activity.map((item, index) => (
                  <li
                    key={item.id}
                    className={`flex gap-4 py-4 ${index > 0 ? 'border-t border-[#f1f5f9]' : ''}`}
                  >
                    <ActivityIcon className="mt-1 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-medium text-[#171a1f]">{item.title}</p>
                      <p className="mt-1 text-xs text-[#565d6d]">
                        {relativeTime(item.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="rounded-[16px] border border-[#e7e4ff] bg-[#f5f2ff] p-6">
            <h2 className="text-base font-bold text-[#171a1f]">Profile Completion</h2>
            <div className="mt-7 h-2.5 rounded-full bg-[#e5e7eb]">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${completion}%` }}
              />
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="font-medium text-[#565d6d]">{completion}% Complete</span>
              <Link href="/tenant/profile-completion" className="font-medium text-primary">
                Finish Setup ›
              </Link>
            </div>
          </Card>
        </aside>
      </main>
    </TenantShell>
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

function ChevronIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
    </svg>
  );
}

function HomeIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

function FileIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
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

function ConnectionsIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="16" r="3" />
      <path d="m10.2 10.2 3.6 3.6" />
      <path d="M16 7h3v3" />
      <path d="m14 10 5-5" />
    </svg>
  );
}

function BadgeStarIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M12 3 4.5 6v6c0 4.7 3.2 7.7 7.5 9 4.3-1.3 7.5-4.3 7.5-9V6z" />
      <path d="m12 8 1.1 2.2 2.4.4-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.4z" />
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
