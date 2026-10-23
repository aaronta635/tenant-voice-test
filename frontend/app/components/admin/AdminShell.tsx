'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import BrandLogo from '@/app/components/BrandLogo';
import SignOutLink from '@/app/components/SignOutLink';
import DemoLabel from '@/app/components/demo/DemoLabel';
import MobileNav from '@/app/components/layout/MobileNav';
import Card from '@/app/components/ui/Card';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { adminApi, type AdminMe } from '@/app/lib/admin-api';
import { ApiError, getAuthToken } from '@/app/lib/api';
import { isDemoAccount } from '@/app/lib/demo';
import { navigateWithinPage } from '@/app/lib/page-url';
import { getClientSessionRole, getClientStaffRole, ROLE_HOME, STAFF_HOME } from '@/app/lib/session-role';
import { staffSignInHref } from '@/app/lib/staff-session';
import { useClientReady } from '@/app/lib/use-client-ready';

// The pages read their query on the client, so each link opens its own page
// through the History API, in the mobile menu too (lib/page-url).
const NAV = [
  { href: '/admin', label: 'Overview', withinPage: true },
  { href: '/admin/users', label: 'Users', withinPage: true },
  { href: '/admin/verification', label: 'Verification', withinPage: true },
  { href: '/admin/reviews', label: 'Reviews', withinPage: true },
  { href: '/admin/listings', label: 'Listings', withinPage: true },
  { href: '/admin/complaints', label: 'Complaints', withinPage: true },
  { href: '/admin/repairs', label: 'Repairs', withinPage: true },
  { href: '/admin/red-flags', label: 'Red flags', withinPage: true },
  { href: '/admin/alerts', label: 'Alerts', withinPage: true },
  { href: '/admin/activity', label: 'Activity log', withinPage: true },
  { href: '/admin/analytics', label: 'Analytics', withinPage: true },
  // Housing Portal officers' requests to change a datapoint (tracker R41).
  { href: '/admin/data-requests', label: 'Data requests', withinPage: true },
];

type Access =
  | { state: 'admin'; me: AdminMe }
  | { state: 'signed-out' }
  | { state: 'refused'; message: string }
  | { state: 'error'; message: string };

/**
 * The admin console's frame. It asks the server (GET /admin/me) whether the
 * signed-in account is an active admin, and shows the console only then:
 * anyone else sees why not, and every admin request is checked again on the
 * server whatever this shows.
 */
export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ready = useClientReady();
  const signedIn = ready && Boolean(getAuthToken());
  const [attempt, setAttempt] = useState(0);
  const [checked, setChecked] = useState<{ attempt: number; access: Access } | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    adminApi.me().then(
      (me) => { if (active) setChecked({ attempt, access: { state: 'admin', me } }); },
      (error) => {
        if (!active) return;
        const access: Access = error instanceof ApiError && error.status === 401
          ? { state: 'signed-out' }
          : error instanceof ApiError && error.status === 403
            ? { state: 'refused', message: error.message }
            : { state: 'error', message: error instanceof ApiError ? error.message : 'Please try again.' };
        setChecked({ attempt, access });
      },
    );
    return () => { active = false; };
  }, [attempt, signedIn]);

  const access: Access | null = !ready ? null : !signedIn ? { state: 'signed-out' } : checked?.attempt === attempt ? checked.access : null;

  if (access?.state !== 'admin') {
    return (
      <div className="flex min-h-screen flex-col items-center bg-background px-4 py-10">
        <BrandLogo href="/" size="md" />
        <main className="mt-8 w-full max-w-xl">
          {!access ? (
            <p role="status" className="text-center text-sm text-text-body">Checking your access…</p>
          ) : access.state === 'error' ? (
            <LoadErrorCard title="Couldn't open the admin console" message={access.message} onRetry={() => setAttempt((value) => value + 1)} />
          ) : (
            <AccessCard access={access} pathname={pathname} />
          )}
        </main>
      </div>
    );
  }

  const isActive = (href: string) => (href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const signOut = (
    <SignOutLink signInHref={staffSignInHref()} className="flex min-h-11 w-full items-center rounded-md px-4 text-sm font-medium text-text-body hover:bg-surface hover:text-text-dark">
      Sign out
    </SignOutLink>
  );

  return (
    <div className="flex min-h-screen bg-background text-text-dark">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-border px-5">
          <BrandLogo href="/admin" onNavigate={navigateWithinPage('/admin')} size="sm" />
        </div>
        <nav aria-label="Admin console" className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onNavigate={navigateWithinPage(item.href)}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={`flex min-h-11 items-center rounded-md px-4 text-sm font-medium ${
                    isActive(item.href) ? 'bg-primary-strong text-white' : 'text-text-body hover:bg-surface hover:text-text-dark'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-border p-3">{signOut}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-white px-4 sm:px-6">
          <MobileNav items={NAV} breakpointClass="lg:hidden">
            <div className="mt-3 border-t border-border pt-3">{signOut}</div>
          </MobileNav>
          <p className="font-heading text-base font-semibold text-text-dark">Admin console</p>
          <p className="ml-auto min-w-0 truncate text-sm text-text-body">{access.me.full_name || access.me.email}</p>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {isDemoAccount(access.me.id) ? (
            <DemoLabel variant="notice" className="mb-6 print:hidden" reason="Sample account: this admin is fictional, for a TenantVoice walkthrough." />
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

/** Signed out: the staff sign-in. Signed in as someone else: why not, and the way back. */
function AccessCard({ access, pathname }: { access: Extract<Access, { state: 'signed-out' | 'refused' }>; pathname: string }) {
  const role = getClientSessionRole();
  const officer = getClientStaffRole() === 'Officer';
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="font-heading text-h3 font-semibold text-text-dark">
        {access.state === 'signed-out' ? 'Sign in to the admin console' : 'You can\'t open the admin console'}
      </h1>
      <p className="mt-2 text-sm text-text-body">
        {access.state === 'signed-out'
          ? 'The admin console is for TenantVoice administrators. Sign in with your staff account.'
          : access.message}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {access.state === 'signed-out' ? (
          <Link href={staffSignInHref(pathname)} className="inline-flex min-h-11 items-center rounded-lg bg-primary-strong px-4 text-sm font-medium text-white hover:bg-navy">
            Staff sign in
          </Link>
        ) : (
          <>
            {officer ? (
              <Link href={STAFF_HOME.Officer} className="inline-flex min-h-11 items-center rounded-lg bg-primary-strong px-4 text-sm font-medium text-white hover:bg-navy">
                Go to the Housing Portal
              </Link>
            ) : role ? (
              <Link href={ROLE_HOME[role]} className="inline-flex min-h-11 items-center rounded-lg bg-primary-strong px-4 text-sm font-medium text-white hover:bg-navy">
                Go to your workspace
              </Link>
            ) : null}
            <SignOutLink signInHref={staffSignInHref(pathname)} className="inline-flex min-h-11 items-center rounded-lg border border-primary-strong px-4 text-sm font-medium text-primary-strong hover:bg-surface">
              Sign in as an admin instead
            </SignOutLink>
          </>
        )}
        <Link href="/" className="text-sm font-semibold text-primary-strong underline">TenantVoice home</Link>
      </div>
    </Card>
  );
}
