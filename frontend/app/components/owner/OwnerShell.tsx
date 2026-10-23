'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import BrandLogo from '@/app/components/BrandLogo';
import DemoLabel from '@/app/components/demo/DemoLabel';
import SignOutLink from '@/app/components/SignOutLink';
import ListMenu from '@/app/components/public/ListMenu';
import { api, safe, type OwnerBadges, type Profile } from '@/app/lib/api';
import { isDemoAccount } from '@/app/lib/demo';
import { initialsOf, ROLE_LABELS } from '@/app/lib/format';
import { navigateWithinPage, pushHref } from '@/app/lib/page-url';

type NavIcon =
  | 'dashboard'
  | 'properties'
  | 'applications'
  | 'recommendations'
  | 'complaints'
  | 'network'
  | 'subscription'
  | 'help'
  | 'search'
  | 'providers'
  | 'profile';

const OWNER_NAV: { href: string; label: string; icon: NavIcon }[] = [
  { href: '/owner', label: 'Dashboard', icon: 'dashboard' },
  { href: '/owner/properties', label: 'Properties', icon: 'properties' },
  { href: '/owner/inspections', label: 'Inspections', icon: 'search' },
  { href: '/owner/applications', label: 'Applications', icon: 'applications' },
  { href: '/owner/leases', label: 'Leases', icon: 'applications' },
  { href: '/owner/rent', label: 'Rent ledger', icon: 'subscription' },
  // The scorecard requests tenants sent (R43): their notice is a review notice, which an owner may switch off.
  { href: '/owner/scorecard', label: 'Scorecards', icon: 'applications' },
  { href: '/owner/bookings', label: 'Service bookings', icon: 'applications' },
  { href: '/categories', label: 'Find Providers', icon: 'providers' },
  { href: '/owner/recommendations', label: 'Recommendations', icon: 'recommendations' },
  { href: '/owner/maintenance', label: 'Maintenance', icon: 'complaints' },
  { href: '/owner/complaints', label: 'Complaints', icon: 'help' },
  { href: '/owner/network', label: 'Network', icon: 'network' },
  { href: '/owner/search-profiles', label: 'Search Profiles', icon: 'search' },
  { href: '/owner/subscription', label: 'Subscription', icon: 'subscription' },
  { href: '/owner/profile', label: 'Profile', icon: 'profile' },
  { href: '/owner/help', label: 'Help & Support', icon: 'help' },
];

const ACCOUNT_MENU = [
  { href: '/owner/profile', label: 'My Profile' },
  { href: '/owner/subscription', label: 'Subscription' },
  { href: '/owner/help', label: 'Help & Support' },
];

export default function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [search, setSearch] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<OwnerBadges | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      // The badges' own call: the whole dashboard is the /owner page's, not every page's.
      const [me, badges, conversations] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe<OwnerBadges | null>(api.dashboard.ownerBadges(), null),
        safe(api.conversations.list(), []),
      ]);
      if (!active) return;
      setProfile(me);
      setStats(badges);
      setUnreadMessages(
        badges?.unread_messages ??
          conversations.reduce((total, c) => total + c.unread_count, 0),
      );
    })();
    return () => {
      active = false;
    };
  }, [pathname]);

  const displayName = profile?.full_name?.split(' ')[0] ?? 'Owner';
  const pendingNetwork = stats?.pending_connections ?? 0;
  const unreadNotifications = stats?.unread_notifications ?? 0;

  return (
    <div className="flex min-h-screen bg-[#f8f9fa] text-[#171a1f]">
      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-[#e5e7eb] bg-white transition-transform lg:static lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center border-b border-[#e5e7eb] px-5">
          <BrandLogo href="/owner" onNavigate={navigateWithinPage('/owner')} size="sm" />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {OWNER_NAV.map((item) => {
            const active =
              item.href === '/owner'
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const badge =
              item.href === '/owner/network'
                ? pendingNetwork
                : item.href === '/owner/applications'
                  ? (stats?.new_application_count ?? 0)
                  : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileNavOpen(false)}
                onNavigate={navigateWithinPage(item.href)}
                className={`flex items-center gap-3 rounded-md px-4 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary text-white'
                    : 'text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#171a1f]'
                }`}
              >
                <NavIcon name={item.icon} className="size-5 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {badge > 0 ? (
                  <span
                    className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                      active ? 'bg-white/20 text-white' : 'bg-primary text-white'
                    }`}
                  >
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Below sm the header has no room for the List menu, so the drawer offers it. */}
        <div className="border-t border-[#e5e7eb] p-3 sm:hidden">
          <ListMenu placement="panel" onFollow={() => setMobileNavOpen(false)} />
        </div>

        <div className="border-t border-[#e5e7eb] p-3">
          <SignOutLink className="flex w-full items-center gap-3 rounded-lg px-4 py-2 text-sm font-medium text-[#6b7280] transition-colors hover:bg-[#f3f4f6] hover:text-[#171a1f]">
            <SignOutIcon className="size-5" />
            Sign Out
          </SignOutLink>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-[#e5e7eb] bg-white px-4 sm:px-6">
          <button
            type="button"
            aria-label="Open navigation"
            className="flex size-9 items-center justify-center rounded-md text-[#565d6d] hover:bg-[#f3f4f6] lg:hidden"
            onClick={() => setMobileNavOpen(true)}
          >
            <MenuIcon className="size-5" />
          </button>

          <form
            className="relative hidden min-w-0 flex-1 items-center md:flex"
            onSubmit={(event) => {
              event.preventDefault();
              const q = search.trim();
              pushHref(
                router,
                q
                  ? `/owner/search-profiles?q=${encodeURIComponent(q)}`
                  : '/owner/search-profiles',
              );
            }}
          >
            <SearchIcon className="pointer-events-none absolute left-3 size-4 text-[#8c97a2]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search tenants, providers"
              placeholder="Search tenants, providers..."
              className="h-10 w-full max-w-xl rounded-full border border-[#e5e7eb] bg-[#f8f9fa] pl-9 pr-3 text-sm text-[#171a1f] outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
            />
          </form>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:block">
              <ListMenu />
            </div>
            <Link
              href="/owner/messages"
              onNavigate={navigateWithinPage('/owner/messages')}
              aria-label={
                unreadMessages > 0 ? `Messages (${unreadMessages} unread)` : 'Messages'
              }
              className="relative flex size-9 items-center justify-center rounded-md text-[#565d6d] hover:bg-[#f3f4f6]"
            >
              <MessageIcon className="size-5" />
              {unreadMessages > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                  {unreadMessages}
                </span>
              ) : null}
            </Link>

            <Link
              href="/owner/notifications"
              aria-label={
                unreadNotifications > 0
                  ? `Notifications (${unreadNotifications} unread)`
                  : 'Notifications'
              }
              className="relative flex size-9 items-center justify-center rounded-md text-[#565d6d] hover:bg-[#f3f4f6]"
            >
              <BellIcon className="size-5" />
              {unreadNotifications > 0 ? (
                <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[#de3b40]" />
              ) : null}
            </Link>

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-[#f3f4f6] sm:pr-3"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-[#f0f1ff] text-xs font-bold text-primary">
                  {initialsOf(profile?.full_name)}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-sm font-semibold leading-4 text-[#171a1f]">
                    {displayName}
                  </span>
                  <span className="block text-xs leading-4 text-[#6b7280]">
                    {ROLE_LABELS[profile?.role ?? ''] ?? 'Owner'}
                  </span>
                </span>
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white py-1 shadow-md"
                >
                  <div className="border-b border-[#e5e7eb] px-3 py-2">
                    <p className="text-sm font-bold text-[#171a1f]">
                      {profile?.full_name ?? 'Owner account'}
                    </p>
                    <p className="text-xs text-[#6b7280]">
                      {ROLE_LABELS[profile?.role ?? ''] ?? 'Owner'}
                    </p>
                  </div>
                  {ACCOUNT_MENU.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="block px-3 py-2 text-sm text-[#565d6d] hover:bg-[#f8f9fa] hover:text-[#171a1f]"
                    >
                      {item.label}
                    </Link>
                  ))}
                  <SignOutLink
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm text-[#565d6d] hover:bg-[#f8f9fa] hover:text-[#171a1f]"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1240px] px-6 py-8">
            {/* Only on the workspace: the public pages this shell also wraps may be real. */}
            {pathname.startsWith('/owner') && isDemoAccount(profile?.id) ? (
              <DemoLabel variant="notice" className="mb-6 print:hidden" reason="Sample account: the people, homes, bookings and messages here are fictional, for a TenantVoice walkthrough." />
            ) : null}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavIcon({ name, className = '' }: { name: NavIcon; className?: string }) {
  switch (name) {
    case 'dashboard':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case 'properties':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="m3 11 9-8 9 8" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case 'applications':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5M9 13h6M9 17h6" />
        </svg>
      );
    case 'recommendations':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
        </svg>
      );
    case 'complaints':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z" />
        </svg>
      );
    case 'network':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <circle cx="8" cy="8" r="3" />
          <circle cx="16" cy="16" r="3" />
          <path d="m10.2 10.2 3.6 3.6" />
          <path d="M16 7h3v3M14 10l5-5" />
        </svg>
      );
    case 'search':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m16.5 16.5 4 4" />
        </svg>
      );
    case 'providers':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z" />
        </svg>
      );
    case 'subscription':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
        </svg>
      );
    case 'profile':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20a8 8 0 0 1 16 0" />
        </svg>
      );
    case 'help':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.6 1.1-1.6 2.3M12 17h.01" />
        </svg>
      );
    default:
      return null;
  }
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

function MessageIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.5-4A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

function MenuIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function SignOutIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M10 17v1a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3h-6a3 3 0 0 0-3 3v1" />
      <path d="M15 12H3m0 0 3-3m-3 3 3 3" />
    </svg>
  );
}
