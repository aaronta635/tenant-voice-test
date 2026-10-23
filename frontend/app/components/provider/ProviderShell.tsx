'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import BrandLogo from '@/app/components/BrandLogo';
import AccountStandingBanner from '@/app/components/provider/AccountStandingBanner';
import DemoNotice from '@/app/components/provider/DemoNotice';
import { isDemoProvider } from '@/app/lib/demo';
import SignOutLink from '@/app/components/SignOutLink';
import ListMenu from '@/app/components/public/ListMenu';
import type { AccountStanding } from '@/app/lib/account-standing';
import { api, type Profile, type ServiceProvider } from '@/app/lib/api';
import { initialsOf, ROLE_LABELS } from '@/app/lib/format';
import { navigateWithinPage, pushHref } from '@/app/lib/page-url';
import { accountMenuLinks } from '@/app/lib/provider-workspace';
import { watchAccount, watchCounts } from '@/app/lib/provider-refresh';

type NavIcon =
  | 'dashboard'
  | 'services'
  | 'bookings'
  | 'repairs'
  | 'availability'
  | 'finances'
  | 'reviews'
  | 'network'
  | 'recommendations'
  | 'complaints'
  | 'search'
  | 'profile';

const PROVIDER_NAV: { href: string; label: string; icon: NavIcon }[] = [
  { href: '/dashboard', label: 'Overview', icon: 'dashboard' },
  { href: '/dashboard/services', label: 'My services', icon: 'services' },
  { href: '/dashboard/bookings', label: 'Bookings', icon: 'bookings' },
  { href: '/dashboard/client-bookings', label: 'My booking requests', icon: 'bookings' },
  { href: '/dashboard/repairs', label: 'Assigned repairs', icon: 'repairs' },
  { href: '/dashboard/availability', label: 'Availability', icon: 'availability' },
  { href: '/dashboard/finances', label: 'Finances', icon: 'finances' },
  { href: '/dashboard/reviews', label: 'Reviews', icon: 'reviews' },
  { href: '/dashboard/recommendations', label: 'Recommendations', icon: 'recommendations' },
  { href: '/dashboard/network', label: 'Network', icon: 'network' },
  { href: '/dashboard/search-profiles', label: 'Search profiles', icon: 'search' },
  { href: '/dashboard/complaints', label: 'Complaints', icon: 'complaints' },
  { href: '/dashboard/profile', label: 'Profile', icon: 'profile' },
];

export default function ProviderShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [search, setSearch] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navButtonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [standing, setStanding] = useState<AccountStanding | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [pendingConnections, setPendingConnections] = useState(0);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // The off-canvas drawer is only a drawer below lg; while closed there it must
  // be out of the tab order (inert) and Esc should close it when open.
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const drawerOpen = mobileNavOpen && !isDesktop;
  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = navRef.current;
    const opener = navButtonRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () => Array.from(drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])') ?? []).filter(element => element.getClientRects().length > 0);
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A popup inside the drawer, such as the List menu, that took the Escape closes alone.
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setMobileNavOpen(false); }
      if (event.key === 'Tab') {
        const items = focusables();
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; opener?.focus(); };
  }, [drawerOpen]);

  // Profile and provider rarely change, so they are not polled: see watchAccount.
  useEffect(() => {
    let active = true;
    const stop = watchAccount({
      window,
      document,
      load: async () => {
        const [me, mine, account] = await Promise.allSettled([
          api.profiles.me(),
          api.providers.mine(),
          // Settled on its own, so a standing that cannot be read never holds back the header.
          Promise.resolve().then(() => api.account.standing()),
        ]);
        if (!active) return;
        if (me.status === 'fulfilled') setProfile(me.value);
        if (mine.status === 'fulfilled') setProvider(mine.value);
        if (account.status === 'fulfilled') setStanding(account.value.state);
      },
    });
    return () => { active = false; stop(); };
  }, []);

  useEffect(() => {
    let active = true;
    const stop = watchCounts({
      window,
      document,
      loadMessageCount: async () => {
        const conversations = await api.conversations.list();
        if (active) setUnreadMessages(conversations.reduce((total, conversation) => total + conversation.unread_count, 0));
      },
      loadOtherCounts: async () => {
        const [notifications, connections] = await Promise.allSettled([api.notifications.list(true), api.connections.list('pending')]);
        if (!active) return;
        if (notifications.status === 'fulfilled') setUnreadNotifications(notifications.value.length);
        if (connections.status === 'fulfilled') setPendingConnections(connections.value.filter(connection => connection.direction === 'incoming').length);
      },
    });
    return () => { active = false; stop(); };
  }, []);

  const displayName =
    provider?.business_name || profile?.full_name?.split(' ')[0] || 'Provider';
  const roleLabel = ROLE_LABELS.service_provider || 'Service provider';
  const headline = provider?.headline || provider?.tagline;
  const accountMenu = accountMenuLinks(provider);

  return (
    <div className="flex min-h-screen bg-[#f8f9fa] text-[#171a1f]">
      <a href="#provider-main" className="fixed left-4 top-3 z-[100] -translate-y-24 rounded-lg border border-border bg-white px-4 py-3 font-semibold text-primary-strong focus:translate-y-0">Skip to main content</a>
      {drawerOpen ? (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        ref={navRef}
        id="provider-navigation"
        role={drawerOpen ? 'dialog' : undefined}
        aria-modal={drawerOpen ? true : undefined}
        aria-label="Workspace navigation"
        inert={!isDesktop && !mobileNavOpen}
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-[#e5e7eb] bg-white transition-transform print:hidden lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:self-start lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-[#e5e7eb] px-5">
          <BrandLogo href="/dashboard" size="sm" onNavigate={navigateWithinPage('/dashboard')} />
          <button type="button" aria-label="Close navigation" className="flex size-11 items-center justify-center rounded-md border border-transparent text-xl lg:hidden" onClick={() => setMobileNavOpen(false)}>×</button>
        </div>

        <nav aria-label="Provider pages" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {PROVIDER_NAV.map((item) => {
            const active =
              item.href === '/dashboard'
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const badge = item.href === '/dashboard/network' ? pendingConnections : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMobileNavOpen(false)}
                onNavigate={navigateWithinPage(item.href)}
                className={`flex min-h-11 items-center gap-3 rounded-md border border-transparent px-4 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary-strong text-white'
                    : 'text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#171a1f]'
                }`}
              >
                <NavIcon name={item.icon} className="size-5 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {badge > 0 ? (
                  <span
                    className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                      active ? 'bg-white/20 text-white' : 'bg-primary-strong text-white'
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
            Sign out
          </SignOutLink>
        </div>
      </aside>

      <div inert={drawerOpen} className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-[#e5e7eb] bg-white print:hidden">
          <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center gap-4 px-4 sm:px-6">
          <button
            type="button"
            ref={navButtonRef}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="provider-navigation"
            className="flex size-11 items-center justify-center rounded-md text-[#565d6d] hover:bg-[#f3f4f6] lg:hidden"
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
                  ? `/dashboard/search-profiles?q=${encodeURIComponent(q)}`
                  : '/dashboard/search-profiles',
              );
            }}
          >
            <SearchIcon className="pointer-events-none absolute left-3 size-4 text-[#5f6b76]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search landlords, tenants"
              placeholder="Search landlords, tenants..."
              className="h-10 w-full max-w-xl rounded-full border border-[#e5e7eb] bg-[#f8f9fa] pl-9 pr-3 text-sm text-[#171a1f] outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
            />
          </form>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:block">
              <ListMenu />
            </div>
            <Link
              href="/dashboard/messages"
              onNavigate={navigateWithinPage('/dashboard/messages')}
              aria-label={
                unreadMessages > 0 ? `Messages (${unreadMessages} unread)` : 'Messages'
              }
              className="relative flex size-11 items-center justify-center rounded-md text-[#565d6d] hover:bg-[#f3f4f6]"
            >
              <MessageIcon className="size-5" />
              {unreadMessages > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary-strong px-1 text-[10px] font-bold text-white">
                  {unreadMessages}
                </span>
              ) : null}
            </Link>

            <Link
              href="/dashboard/notifications"
              aria-label={
                unreadNotifications > 0
                  ? `Notifications (${unreadNotifications} unread)`
                  : 'Notifications'
              }
              className="relative flex size-11 items-center justify-center rounded-md text-[#565d6d] hover:bg-[#f3f4f6]"
            >
              <BellIcon className="size-5" />
              {unreadNotifications > 0 ? (
                <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[#de3b40] forced-colors:bg-[Highlight]" />
              ) : null}
            </Link>

            <div className="relative" ref={menuRef} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false); }} onKeyDown={event => { if (event.key === 'Escape' && menuOpen) { event.preventDefault(); setMenuOpen(false); menuButtonRef.current?.focus(); } }}>
              <button
                type="button"
                aria-label="Account menu"
                ref={menuButtonRef}
                aria-controls="provider-account-links"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-[#f3f4f6] sm:pr-3"
              >
                <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-surface text-xs font-bold text-primary-strong">
                  {initialsOf(displayName)}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-sm font-semibold leading-4 text-[#171a1f]">
                    {displayName}
                  </span>
                  <span title={headline ?? undefined} className="block text-xs leading-4 text-text-body">
                    {roleLabel}
                  </span>
                </span>
              </button>
              {menuOpen ? (
                <div
                  id="provider-account-links"
                  aria-label="Account links"
                  className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white py-1 shadow-md"
                >
                  <div className="border-b border-[#e5e7eb] px-3 py-2">
                    <p className="text-sm font-bold text-[#171a1f]">
                      {provider?.business_name || profile?.full_name || 'Provider account'}
                    </p>
                    <p className="text-xs text-text-body">{headline || roleLabel}</p>
                  </div>
                  {accountMenu.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className="flex min-h-11 items-center px-3 py-2 text-sm text-[#565d6d] hover:bg-[#f8f9fa] hover:text-[#171a1f]"
                    >
                      {item.label}
                    </Link>
                  ))}
                  <SignOutLink
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-11 items-center px-3 py-2 text-sm text-[#565d6d] hover:bg-[#f8f9fa] hover:text-[#171a1f]"
                  />
                </div>
              ) : null}
            </div>
          </div>
          </div>
        </header>

        <main id="provider-main" tabIndex={-1} className="min-w-0 flex-1 scroll-mt-20">
          <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8">
          {pathname.startsWith('/dashboard') ? <AccountStandingBanner state={standing} /> : null}
          {pathname.startsWith('/dashboard') && isDemoProvider(profile?.id) ? (
            <div className="print:hidden">
              <DemoNotice />
            </div>
          ) : null}
            {children}
          </div>
        </main>
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
    case 'services':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z" />
        </svg>
      );
    case 'bookings':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      );
    case 'repairs':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5 10v10h14V10" />
          <path d="m10 15 2 2 3-4" />
        </svg>
      );
    case 'availability':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'finances':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6" />
        </svg>
      );
    case 'reviews':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
        </svg>
      );
    case 'recommendations':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden><path d="m9 3 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Zm10 11 1.2 3.8L24 19l-3.8 1.2L19 24l-1.2-3.8L14 19l3.8-1.2L19 14Z" /></svg>;
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
    case 'complaints':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
        </svg>
      );
    case 'profile':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20a8 8 0 0 1 16 0" />
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
