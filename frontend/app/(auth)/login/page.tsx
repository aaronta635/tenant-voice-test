'use client';

import { Suspense, useMemo, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ROLE_LABELS } from '@/app/lib/format';
import { authPageHref, isAdminPath, isHousingPath, safeNextPath, roleForSignIn } from '@/app/lib/auth-redirect';
import ExistingSession from '@/app/components/public/ExistingSession';
import { getClientStaffRole, ROLE_HOME, STAFF_HOME, type SessionRole } from '@/app/lib/session-role';
import { api, ApiError, getAuthToken, setAuthSession, toBackendRole, toSessionRole } from '@/app/lib/api';
import { staffLanding, staffRoleOf, staffSignInHref, startStaffSession } from '@/app/lib/staff-session';
import { useClientReady } from '@/app/lib/use-client-ready';

type Role = SessionRole;

const ROLES: { id: Role; label: string; blurb: string }[] = [
  {
    id: 'Client',
    label: ROLE_LABELS.tenant,
    blurb: 'Book inspectors, agents, tradies & more',
  },
  {
    id: 'Provider',
    label: ROLE_LABELS.service_provider,
    blurb: 'Manage services, bookings & earnings',
  },
  {
    id: 'Owner',
    label: ROLE_LABELS.landlord,
    blurb: 'Manage properties, tenants & applications',
  },
];

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[#5f6b76]">Loading sign in…</p>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Staff (admins and Housing Portal officers) have no account type to pick:
  // their sign-in asks for none, and the backend signs them in as their users row says.
  const next = searchParams.get('next');
  const staff = searchParams.get('account') === 'staff' || isAdminPath(next) || isHousingPath(next);
  // Null until the visitor picks a tab, unless the link names an account type.
  const [role, setRole] = useState<Role | null>(() => (staff ? null : roleForSignIn(searchParams.get('role'), searchParams.get('next'))));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const cta = useMemo(
    () => (staff ? 'Sign in as staff' : role === 'Provider' ? 'Sign in to workspace' : 'Sign in'),
    [role, staff],
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { access_token, refresh_token, profile } = await api.auth.login({
        email: email.trim(),
        password,
        role: !staff && role ? toBackendRole(role) : undefined,
      });
      const staffRole = staffRoleOf(profile.role);
      if (staffRole) {
        // Every admin and portal page asks the server again; this only keeps the session.
        startStaffSession(access_token, refresh_token, staffRole);
        router.push(staffLanding(searchParams.get('next'), staffRole));
        router.refresh();
        return;
      }
      if (staff) {
        setError('This sign-in is for TenantVoice staff: administrators and Housing Portal officers. Use the regular sign-in for your account.');
        setSubmitting(false);
        return;
      }
      // With a tab chosen the backend has already rejected a mismatch; without
      // one it signs the account in as what it is. Trust the DB role either way.
      const uiRole = toSessionRole(profile.role) ?? role;
      if (!uiRole) {
        setError('This account type cannot sign in to the TenantVoice website.');
        setSubmitting(false);
        return;
      }
      setAuthSession(access_token, uiRole, refresh_token);
      router.push(safeNextPath(searchParams.get('next')) ?? ROLE_HOME[uiRole]);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-[24px] border border-[#efeff2] bg-white p-7 shadow-[0_12px_32px_rgba(14,42,72,0.08)] sm:p-9">
      <div className="lg:hidden">
        <p className="text-xs font-semibold tracking-wide text-primary-strong uppercase">
          Welcome back
        </p>
      </div>

      <h1
        className="text-[26px] font-extrabold tracking-tight text-[#1b1b1f]"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        {staff ? 'Staff sign in' : 'Sign in'}
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-[#5f6b76]">
        {staff
          ? 'For TenantVoice administrators and Housing Portal officers. The TenantVoice team sets up staff accounts; they cannot be registered here.'
          : 'Use the same TenantVoice account you browse the marketplace with.'}
      </p>

      {staff ? null : <div
        role="group"
        aria-label="Account type"
        className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {ROLES.map((item) => {
          const active = role === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => { setRole(item.id); setError(null); }}
              className={`rounded-[16px] border px-3 py-3 text-left transition-all ${
                active
                  ? 'border-primary/40 bg-[#eeeffd] shadow-[0_1px_1px_rgba(99,106,232,0.2)]'
                  : 'border-[#efeff2] bg-[#fafafe] hover:border-[#c5cad3]'
              }`}
            >
              <span
                className={`block text-sm font-bold ${
                  active ? 'text-primary-strong' : 'text-[#1b1b1f]'
                }`}
              >
                {item.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-text-body">
                {item.blurb}
              </span>
            </button>
          );
        })}
      </div>}

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-[12px] border border-[#f5c6cb] bg-[#fdecee] px-4 py-3 text-sm font-medium text-[#a12b3b]"
        >
          {error}
        </p>
      ) : null}

      <ExistingSession />
      <ExistingStaffSession />
      {searchParams.get('reason') === 'session-expired' ? <p role="status" className="mt-4 text-sm text-text-body">Your session expired. Sign in again to continue.</p> : null}
      {searchParams.get('reason') === 'password-updated' ? <p role="status" className="mt-4 rounded-[12px] border border-success px-4 py-3 text-sm font-medium text-success">Password updated. Sign in with your new password.</p> : null}
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field
          id="login-email"
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label
              htmlFor="login-password"
              className="text-xs font-bold tracking-wide text-text-body uppercase"
            >
              Password
            </label>
            <Link href="/forgot-password" className="text-xs font-semibold text-primary-strong hover:underline">
              Forgot?
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="h-12 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 text-sm text-[#1b1b1f] outline-none transition-shadow placeholder:text-text-body focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-full border border-transparent bg-primary-strong text-sm font-bold text-white shadow-[0_4px_12px_rgba(99,106,232,0.35)] transition-colors hover:bg-navy disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : cta}
        </button>
      </form>

      {staff ? (
        <p className="mt-6 text-center text-sm text-[#5f6b76]">
          Not TenantVoice staff?{' '}
          <Link href="/login" className="font-semibold text-primary-strong hover:underline">
            Sign in to your account
          </Link>
        </p>
      ) : (
        <>
          <p className="mt-6 text-center text-sm text-[#5f6b76]">
            New here?{' '}
            <Link href={authPageHref('/register', role ? toBackendRole(role) : null, searchParams.get('next'))} className="font-semibold text-primary-strong hover:underline">
              Create an account
            </Link>
          </p>
          <p className="mt-3 text-center text-sm text-[#5f6b76]">
            TenantVoice staff?{' '}
            <Link href={staffSignInHref()} className="font-semibold text-primary-strong hover:underline">
              Staff sign in
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

/** Staff already signed in go back to their own area (ExistingSession covers workspace roles). */
function ExistingStaffSession() {
  const ready = useClientReady();
  const staffRole = ready && getAuthToken() ? getClientStaffRole() : null;
  if (!staffRole) return null;
  return (
    <p role="status" className="mt-4 rounded-xl border border-border p-3 text-sm text-text-body">
      You are already signed in.{' '}
      <Link className="font-semibold text-primary-strong underline" href={STAFF_HOME[staffRole]}>
        {staffRole === 'Officer' ? 'Continue to the Housing Portal' : 'Continue to the admin console'}
      </Link>.
    </p>
  );
}

function Field({
  id,
  label,
  type,
  placeholder,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-bold tracking-wide text-text-body uppercase"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
        className="h-12 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 text-sm text-[#1b1b1f] outline-none transition-shadow placeholder:text-text-body focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}
