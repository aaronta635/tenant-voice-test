'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import BrandLogo from '@/app/components/BrandLogo';
import DemoLabel from '@/app/components/demo/DemoLabel';
import SignOutLink from '@/app/components/SignOutLink';
import ListMenu from '@/app/components/public/ListMenu';
import { api, safe, type Profile } from '@/app/lib/api';
import { isDemoAccount } from '@/app/lib/demo';
import { initialsOf, ROLE_LABELS } from '@/app/lib/format';
import { navigateWithinPage, pushHref } from '@/app/lib/page-url';
import { TENANT_NAV, type TenantNavIcon } from '@/app/lib/tenant-data';

const ACCOUNT_MENU = [
  { href: '/tenant/my-profile', label: 'My Profile' },
  { href: '/tenant/settings', label: 'Settings' },
  { href: '/tenant/write-review', label: 'Ratings & Reviews' },
  { href: '/tenant/manage-subscription', label: 'Subscription' },
];

export default function TenantShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [search, setSearch] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
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
      const [me, conversations] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe(api.conversations.list(), []),
      ]);
      if (!active) return;
      setProfile(me);
      setUnreadMessages(conversations.reduce((total, c) => total + c.unread_count, 0));
    })();
    return () => {
      active = false;
    };
  }, [pathname]);

  const displayName = profile?.full_name?.split(' ')[0] ?? 'Tenant';

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
          <BrandLogo href="/tenant/dashboard" onNavigate={navigateWithinPage('/tenant/dashboard')} size="sm" />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {TENANT_NAV.map((item) => {
            const active =
              item.href === '/tenant/dashboard'
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
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
                <span>{item.label}</span>
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
                  ? `/tenant/search-profile?q=${encodeURIComponent(q)}`
                  : '/tenant/search-profile',
              );
            }}
          >
            <SearchIcon className="pointer-events-none absolute left-3 size-4 text-[#8c97a2]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search tenants, owners, providers"
              placeholder="Search tenants, owners, providers..."
              className="h-10 w-full max-w-xl rounded-full border border-[#e5e7eb] bg-[#f8f9fa] pl-9 pr-3 text-sm text-[#171a1f] outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
            />
          </form>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:block">
              <ListMenu />
            </div>
            <Link
              href="/tenant/messages"
              onNavigate={navigateWithinPage('/tenant/messages')}
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
              href="/tenant/notifications"
              aria-label="Notifications"
              className="relative flex size-9 items-center justify-center rounded-md text-[#565d6d] hover:bg-[#f3f4f6]"
            >
              <BellIcon className="size-5" />
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
                    {ROLE_LABELS[profile?.role ?? ''] ?? 'Tenant'}
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
                      {profile?.full_name ?? 'Tenant account'}
                    </p>
                    <p className="text-xs text-[#6b7280]">
                      {ROLE_LABELS[profile?.role ?? ''] ?? 'Tenant'}
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
          {/* Only on the workspace: the public pages this shell also wraps may be real. */}
          {pathname.startsWith('/tenant') && isDemoAccount(profile?.id) ? (
            <div className="mx-auto w-full max-w-[1240px] px-6 pt-6 print:hidden">
              <DemoLabel variant="notice" reason="Sample account: the people, homes, bookings and messages here are fictional, for a TenantVoice walkthrough." />
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

function NavIcon({ name, className = '' }: { name: TenantNavIcon; className?: string }) {
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
    case 'applications':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5M9 13h6M9 17h6" />
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
    case 'recommendations':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
        </svg>
      );
    case 'repairs':
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
    case 'score':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="M12 3 4.5 6v6c0 4.7 3.2 7.7 7.5 9 4.3-1.3 7.5-4.3 7.5-9V6z" />
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
