'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import BrandLogo from '@/app/components/BrandLogo';
import SignOutLink from '@/app/components/SignOutLink';
import { api, safe, type Profile } from '@/app/lib/api';
import { initialsOf, ROLE_LABELS } from '@/app/lib/format';
import { TENANT_NAV } from '@/app/lib/tenant-data';

const ACCOUNT_MENU = [
  { href: '/tenant/my-profile', label: 'My Profile' },
  { href: '/tenant/settings', label: 'Settings' },
  { href: '/tenant/manage-subscription', label: 'Subscription' },
];

export default function TenantShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

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
      const me = await safe<Profile | null>(api.profiles.me(), null);
      if (active) setProfile(me);
    })();
    return () => {
      active = false;
    };
  }, [pathname]);

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#171a1f]">
      <header className="sticky top-0 z-30 border-b border-[#dee1e6] bg-white">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-6 lg:px-8">
          <div className="w-[150px] shrink-0">
            <BrandLogo href="/tenant/dashboard" size="sm" />
          </div>
          <nav className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
            {TENANT_NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`rounded-[4px] px-4 py-2 text-sm font-medium ${
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
                className="h-10 w-full rounded-full border border-[#dee1e6] bg-[#f8f9fa] pl-9 pr-3 text-sm text-[#171a1f] outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
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
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
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
                      {profile?.full_name ?? 'Tenant account'}
                    </p>
                    <p className="text-xs text-text-subtle">
                      {ROLE_LABELS[profile?.role ?? ''] ?? 'Tenant'}
                    </p>
                  </div>
                  {ACCOUNT_MENU.map((item) => (
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
      {children}
    </div>
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
