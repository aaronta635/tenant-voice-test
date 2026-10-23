'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import BrandLogo from '@/app/components/BrandLogo';
import SignOutLink from '@/app/components/SignOutLink';
import MobileNav from '@/app/components/layout/MobileNav';
import Card from '@/app/components/ui/Card';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { ApiError, getAuthToken } from '@/app/lib/api';
import { housingApi, type OfficerMe } from '@/app/lib/housing-api';
import { getClientSessionRole, getClientStaffRole, ROLE_HOME, STAFF_HOME } from '@/app/lib/session-role';
import { staffSignInHref } from '@/app/lib/staff-session';
import { useClientReady } from '@/app/lib/use-client-ready';

export const HOUSING_NAV = [
  { href: '/housing', label: 'Overview' },
  { href: '/housing/referrals', label: 'Referrals' },
  { href: '/housing/red-flags', label: 'Red-flag alerts' },
  { href: '/housing/complaints', label: 'Complaints and outcomes' },
  { href: '/housing/data-requests', label: 'Data requests' },
  { href: '/housing/surveys', label: 'Surveys' },
  { href: '/housing/aggregates', label: 'Aggregates' },
];

type Access =
  | { state: 'officer'; me: OfficerMe }
  | { state: 'signed-out' }
  | { state: 'refused'; message: string }
  | { state: 'error'; message: string };

/**
 * The Housing Portal's frame (tracker R41). It asks the server (GET
 * /housing/me) whether the signed-in account is an active officer, and shows
 * the portal only then: anyone else, admins included, sees why not, and every
 * portal request is checked again on the server whatever this shows.
 */
export default function HousingShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ready = useClientReady();
  const signedIn = ready && Boolean(getAuthToken());
  const [attempt, setAttempt] = useState(0);
  const [checked, setChecked] = useState<{ attempt: number; access: Access } | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    housingApi.me().then(
      (me) => { if (active) setChecked({ attempt, access: { state: 'officer', me } }); },
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

  if (access?.state !== 'officer') {
    return (
      <div className="flex min-h-screen flex-col items-center bg-background px-4 py-10">
        <BrandLogo href="/" size="md" />
        <main className="mt-8 w-full max-w-xl">
          {!access ? (
            <p role="status" className="text-center text-sm text-text-body">Checking your access…</p>
          ) : access.state === 'error' ? (
            <LoadErrorCard title="Couldn't open the Housing Portal" message={access.message} onRetry={() => setAttempt((value) => value + 1)} />
          ) : (
            <AccessCard access={access} pathname={pathname} />
          )}
        </main>
      </div>
    );
  }

  const isActive = (href: string) => (href === '/housing' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const signOut = (
    <SignOutLink signInHref={staffSignInHref()} className="flex min-h-11 w-full items-center rounded-md px-4 text-sm font-medium text-text-body hover:bg-surface hover:text-text-dark">
      Sign out
    </SignOutLink>
  );

  return (
    <div className="flex min-h-screen bg-background text-text-dark">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-white lg:flex print:hidden">
        <div className="flex h-16 items-center border-b border-border px-5">
          <BrandLogo href="/housing" size="sm" />
        </div>
        <nav aria-label="Housing Portal" className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {HOUSING_NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-white px-4 sm:px-6 print:static">
          <MobileNav items={HOUSING_NAV} breakpointClass="lg:hidden">
            <div className="mt-3 border-t border-border pt-3">{signOut}</div>
          </MobileNav>
          <p className="font-heading text-base font-semibold text-text-dark">Housing Portal</p>
          <p className="ml-auto min-w-0 truncate text-sm text-text-body">{access.me.full_name || access.me.email}</p>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/** Signed out: the staff sign-in. Signed in as anyone else: why not, and the way back. */
function AccessCard({ access, pathname }: { access: Extract<Access, { state: 'signed-out' | 'refused' }>; pathname: string }) {
  const role = getClientSessionRole();
  const staffRole = getClientStaffRole();
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="font-heading text-h3 font-semibold text-text-dark">
        {access.state === 'signed-out' ? 'Sign in to the Housing Portal' : 'You can\'t open the Housing Portal'}
      </h1>
      <p className="mt-2 text-sm text-text-body">
        {access.state === 'signed-out'
          ? 'The Housing Portal is for authorised housing officers. Sign in with your staff account.'
          : access.message}
      </p>
      {access.state === 'refused' && staffRole === 'Admin' ? (
        <p className="mt-2 text-sm text-text-body">Admins prepare referrals for the portal in the admin console.</p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {access.state === 'signed-out' ? (
          <Link href={staffSignInHref(pathname)} className="inline-flex min-h-11 items-center rounded-lg bg-primary-strong px-4 text-sm font-medium text-white hover:bg-navy">
            Staff sign in
          </Link>
        ) : (
          <>
            {staffRole === 'Admin' ? (
              <Link href={STAFF_HOME.Admin} className="inline-flex min-h-11 items-center rounded-lg bg-primary-strong px-4 text-sm font-medium text-white hover:bg-navy">
                Go to the admin console
              </Link>
            ) : role ? (
              <Link href={ROLE_HOME[role]} className="inline-flex min-h-11 items-center rounded-lg bg-primary-strong px-4 text-sm font-medium text-white hover:bg-navy">
                Go to your workspace
              </Link>
            ) : null}
            <SignOutLink signInHref={staffSignInHref(pathname)} className="inline-flex min-h-11 items-center rounded-lg border border-primary-strong px-4 text-sm font-medium text-primary-strong hover:bg-surface">
              Sign in as an officer instead
            </SignOutLink>
          </>
        )}
        <Link href="/" className="text-sm font-semibold text-primary-strong underline">TenantVoice home</Link>
      </div>
    </Card>
  );
}
