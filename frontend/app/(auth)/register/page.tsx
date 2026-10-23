'use client';

import { Suspense, useMemo, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ROLE_LABELS } from '@/app/lib/format';
import { authPageHref, registerLanding, roleForSignIn, roleForSignUp } from '@/app/lib/auth-redirect';
import ExistingSession from '@/app/components/public/ExistingSession';
import type { SessionRole } from '@/app/lib/session-role';
import { api, ApiError, setAuthSession, toBackendRole, toSessionRole } from '@/app/lib/api';

type Role = SessionRole;

const ROLES: { id: Role; label: string; blurb: string }[] = [
  {
    id: 'Client',
    label: ROLE_LABELS.tenant,
    blurb: 'Find & book verified property pros',
  },
  {
    id: 'Provider',
    label: ROLE_LABELS.service_provider,
    blurb: 'List upfront-priced services on TenantVoice',
  },
  {
    id: 'Owner',
    label: ROLE_LABELS.landlord,
    blurb: 'List properties and review applications',
  },
];

export default function RegisterPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[#5f6b76]">Loading registration…</p>}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [role, setRole] = useState<Role>(() => roleForSignUp(searchParams.get('role'), searchParams.get('next')));
  // "Sign in" names an account type only if the link did or the visitor picked one.
  const [roleChosen, setRoleChosen] = useState(() => roleForSignIn(searchParams.get('role'), searchParams.get('next')) !== null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const title = useMemo(() => {
    if (role === 'Provider') return 'List your service';
    if (role === 'Owner') return 'Set up your landlord account';
    return 'Create your account';
  }, [role]);

  const subtitle = useMemo(() => {
    if (role === 'Provider') {
      return 'Start your provider profile — same marketplace clients already browse.';
    }
    if (role === 'Owner') {
      return 'Manage listings, applications, and property operations in one place.';
    }
    return 'Save providers, book upfront-priced jobs, and leave verified reviews.';
  }, [role]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setInvalidField(null);
    if (!fullName.trim()) {
      setError('Enter your full name.');
      setInvalidField('reg-name');
      document.getElementById('reg-name')?.focus();
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      setInvalidField('reg-password');
      document.getElementById('reg-password')?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const { access_token, refresh_token, profile } = await api.auth.register({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        role: toBackendRole(role),
      });
      // The DB trigger creates the profile from the signup metadata; trust the
      // role it actually stored rather than the tab, so the session and the
      // account can never disagree.
      const uiRole = toSessionRole(profile.role) ?? role;
      setAuthSession(access_token, uiRole, refresh_token);
      router.push(registerLanding(uiRole, searchParams.get('next')));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-[24px] border border-[#efeff2] bg-white p-7 shadow-[0_12px_32px_rgba(14,42,72,0.08)] sm:p-9">
      <h1
        className="text-[26px] font-extrabold tracking-tight text-[#1b1b1f]"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        {title}
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-[#5f6b76]">{subtitle}</p>

      <div
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
              onClick={() => { setRole(item.id); setRoleChosen(true); setError(null); }}
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
      </div>

      {error ? (
        <p
          id="registration-error"
          role="alert"
          className="mt-5 rounded-[12px] border border-[#f5c6cb] bg-[#fdecee] px-4 py-3 text-sm font-medium text-[#a12b3b]"
        >
          {error}
        </p>
      ) : null}

      <ExistingSession />
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field
          id="reg-name"
          label="Full name"
          type="text"
          placeholder="Amelia Whitlock"
          value={fullName}
          onChange={setFullName}
          autoComplete="name"
          invalid={invalidField === 'reg-name'}
        />
        <Field
          id="reg-email"
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <Field
          id="reg-password"
          label="Password"
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          invalid={invalidField === 'reg-password'}
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-full border border-transparent bg-primary-strong text-sm font-bold text-white shadow-[0_4px_12px_rgba(99,106,232,0.35)] transition-colors hover:bg-navy disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting
            ? 'Creating account…'
            : role === 'Provider'
              ? 'Continue to workspace'
              : role === 'Owner'
                ? 'Continue to set up your profile'
                : 'Create account'}
        </button>
      </form>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-text-body">
        By continuing you agree to the TenantVoice{' '}
        <Link href="/terms" className="font-semibold text-primary-strong hover:underline">
          Terms
        </Link>{' '}
        and acknowledge the{' '}
        <Link href="/privacy" className="font-semibold text-primary-strong hover:underline">
          Privacy Policy
        </Link>
        .
      </p>

      <p className="mt-5 text-center text-sm text-[#5f6b76]">
        Already have an account?{' '}
        <Link href={authPageHref('/login', roleChosen ? toBackendRole(role) : null, searchParams.get('next'))} className="font-semibold text-primary-strong hover:underline">
          Sign in
        </Link>
      </p>
    </div>
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
  invalid = false,
  minLength,
}: {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  invalid?: boolean;
  minLength?: number;
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
        minLength={minLength}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? "registration-error" : undefined}
        className="h-12 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 text-sm text-[#1b1b1f] outline-none transition-shadow placeholder:text-text-body focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}
