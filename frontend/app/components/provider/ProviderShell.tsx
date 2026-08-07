'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import BrandLogo from '@/app/components/BrandLogo';
import SignOutLink from '@/app/components/SignOutLink';
import { api, safe, type Profile, type ServiceProvider } from '@/app/lib/api';
import { initialsOf } from '@/app/lib/format';
import { providerHref } from '@/app/lib/provider-view';

// Route registry for the workspace chrome (navigation, not content).
const PROVIDER_NAV = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'My Services', href: '/dashboard/services' },
  { label: 'Bookings', href: '/dashboard/bookings' },
  { label: 'Messages', href: '/dashboard/messages' },
  { label: 'Finances', href: '/dashboard/finances' },
  { label: 'Reviews', href: '/dashboard/reviews' },
] as const;

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export default function ProviderShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

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
      const [me, mine, conversations, notifications] = await Promise.all([
        safe(api.profiles.me(), null),
        safe<ServiceProvider | null>(api.providers.mine(), null),
        safe(api.conversations.list(), []),
        safe(api.notifications.list(true), []),
      ]);
      if (!active) return;
      setProfile(me);
      setProvider(mine);
      setUnreadMessages(conversations.reduce((total, c) => total + c.unread_count, 0));
      setUnreadNotifications(notifications.length);
    })();
    return () => {
      active = false;
    };
  }, [pathname]);

  const displayName = provider?.business_name || profile?.full_name || 'Provider workspace';
  const roleLabel = provider?.headline || provider?.tagline || 'Service provider';
  const publicHref = provider ? providerHref(provider) : null;

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafe]">
      <header className="sticky top-0 z-40 h-[72px] border-b border-[#efeff2] bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-6 px-6 lg:px-14">
          <div className="flex items-center gap-8">
            <BrandLogo href="/dashboard" size="sm" />
            <nav className="hidden items-center gap-1 md:flex">
              {PROVIDER_NAV.map((item) => {
                const active =
                  item.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : pathname.startsWith(item.href);
                const badge = item.href === '/dashboard/messages' ? unreadMessages : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative rounded-full px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'font-bold text-[#1b1b1f]'
                        : 'font-medium text-[#5f6b76] hover:text-[#1b1b1f]'
                    }`}
                  >
                    {item.label}
                    {badge > 0 ? (
                      <span className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                        {badge}
                      </span>
                    ) : null}
                    {active ? (
                      <span className="absolute inset-x-3 -bottom-[14px] h-0.5 rounded-full bg-primary" />
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="relative rounded-[10px] border border-[#efeff2] p-2 text-[#5f6b76] hover:text-[#1b1b1f]"
              aria-label={`Notifications${unreadNotifications ? ` (${unreadNotifications} unread)` : ''}`}
            >
              <BellIcon />
              {unreadNotifications > 0 ? (
                <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500" />
              ) : null}
            </button>

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                className="flex size-9 items-center justify-center rounded-full bg-[#eeeffd] text-xs font-bold text-[#0e2a48] ring-offset-2 hover:ring-2 hover:ring-primary/30"
              >
                {initialsOf(profile?.full_name)}
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-[14px] border border-[#efeff2] bg-white py-1 shadow-[0_12px_24px_rgba(14,42,72,0.12)]"
                >
                  <div className="border-b border-[#f4f4f8] px-3 py-2">
                    <p className="text-sm font-bold text-[#1b1b1f]">{displayName}</p>
                    <p className="text-xs text-[#8c97a2]">{roleLabel}</p>
                  </div>
                  {[
                    { href: '/dashboard/profile', label: 'My Profile' },
                    { href: '/dashboard/onboarding', label: 'Complete setup' },
                    { href: '/dashboard/settings', label: 'Settings' },
                    ...(publicHref ? [{ href: publicHref, label: 'Public profile' }] : []),
                  ].map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="block px-3 py-2 text-sm text-[#5f6b76] hover:bg-[#fafafe] hover:text-[#1b1b1f]"
                    >
                      {item.label}
                    </Link>
                  ))}
                  <SignOutLink
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm text-[#5f6b76] hover:bg-[#fafafe] hover:text-[#1b1b1f]"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-8 lg:px-14">{children}</main>

      <footer className="border-t border-[#efeff2] bg-white py-4 text-center text-sm text-[#8c97a2]">
        TenantVoice · Provider workspace
      </footer>
    </div>
  );
}
