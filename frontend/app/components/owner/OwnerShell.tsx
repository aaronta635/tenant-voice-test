'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import BrandLogo from '@/app/components/BrandLogo';
import SignOutLink from '@/app/components/SignOutLink';
import { api, safe, type OwnerDashboard, type Profile } from '@/app/lib/api';
import { initialsOf, ROLE_LABELS } from '@/app/lib/format';

// See docs/navigation-flow.md "Persistent navigation". This is route
// configuration, not content — every value rendered below comes from the API.
const OWNER_NAV = [
  { href: '/owner', label: 'Dashboard' },
  { href: '/owner/properties', label: 'Properties' },
  { href: '/owner/messages', label: 'Messages' },
  { href: '/owner/network', label: 'Network' },
  { href: '/owner/subscription', label: 'Subscription' },
  { href: '/owner/help', label: 'Help & Support' },
];

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export default function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<OwnerDashboard | null>(null);
  const [search, setSearch] = useState('');

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
      const [me, dashboard] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe<OwnerDashboard | null>(api.dashboard.owner(), null),
      ]);
      if (!active) return;
      setProfile(me);
      setStats(dashboard);
    })();
    return () => {
      active = false;
    };
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 h-[80px] border-b border-border bg-white">
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-6 px-6 lg:px-14">
          <div className="flex items-center gap-8">
            <BrandLogo href="/owner" size="sm" />
            <nav className="hidden items-center gap-1 md:flex">
              {OWNER_NAV.map((item) => {
                const active =
                  item.href === '/owner' ? pathname === '/owner' : pathname.startsWith(item.href);
                const badge =
                  item.href === '/owner/messages'
                    ? (stats?.unread_messages ?? 0)
                    : item.href === '/owner/network'
                      ? (stats?.pending_connections ?? 0)
                      : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-full px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'font-bold text-text-dark'
                        : 'font-medium text-text-muted hover:text-text-dark'
                    }`}
                  >
                    {item.label}
                    {badge > 0 ? (
                      <span className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <form
              className="hidden items-center gap-2 rounded-full border border-border bg-[#fafafb] px-3.5 py-2.5 lg:flex"
              onSubmit={(event) => {
                event.preventDefault();
                router.push(`/owner/properties?q=${encodeURIComponent(search)}`);
              }}
            >
              <SearchIcon />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search properties..."
                aria-label="Search properties"
                className="w-[220px] bg-transparent text-sm text-text-body placeholder:text-text-body focus:outline-none"
              />
            </form>

            <Link
              href="/owner/notifications"
              className="relative rounded-[10px] border border-border p-2 text-text-muted hover:text-text-dark"
              aria-label={`Notifications${stats?.unread_notifications ? ` (${stats.unread_notifications} unread)` : ''}`}
            >
              <BellIcon />
              {stats && stats.unread_notifications > 0 ? (
                <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-[#de3b40]" />
              ) : null}
            </Link>

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                className="flex size-9 items-center justify-center rounded-full bg-surface text-xs font-bold text-navy ring-offset-2 hover:ring-2 hover:ring-primary/30"
              >
                {initialsOf(profile?.full_name)}
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-[14px] border border-border bg-white py-1 shadow-md"
                >
                  <div className="border-b border-border px-3 py-2">
                    <p className="text-sm font-bold text-text-dark">
                      {profile?.full_name ?? 'Owner workspace'}
                    </p>
                    <p className="text-xs text-text-subtle">
                      {ROLE_LABELS[profile?.role ?? ''] ?? 'Owner'}
                    </p>
                  </div>
                  {[
                    { href: '/owner/profile', label: 'My Profile' },
                    { href: '/owner/subscription', label: 'Subscription' },
                  ].map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="block px-3 py-2 text-sm text-text-body hover:bg-background hover:text-text-dark"
                    >
                      {item.label}
                    </Link>
                  ))}
                  <SignOutLink
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm text-text-body hover:bg-background hover:text-text-dark"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-8 lg:px-14">{children}</main>

      <footer className="border-t border-border bg-white py-4 text-center text-sm text-text-subtle">
        TenantVoice. All rights reserved.
      </footer>
    </div>
  );
}
