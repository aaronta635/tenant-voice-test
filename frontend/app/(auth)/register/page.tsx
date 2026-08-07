'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { SessionRole } from '@/app/lib/session-role';
import { api, ApiError, setAuthSession, toBackendRole } from '@/app/lib/api';

type Role = SessionRole;

const ROLES: { id: Role; label: string; blurb: string }[] = [
  {
    id: 'Client',
    label: 'Client',
    blurb: 'Find & book verified property pros',
  },
  {
    id: 'Provider',
    label: 'Provider',
    blurb: 'List fixed-price services on TenantVoice',
  },
  {
    id: 'Owner',
    label: 'Owner',
    blurb: 'List properties and review applications',
  },
];

const REGISTER_LANDING: Record<Role, string> = {
  Provider: '/dashboard/onboarding',
  Owner: '/owner',
  Client: '/tenant/dashboard',
};

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('Provider');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const title = useMemo(() => {
    if (role === 'Provider') return 'List your service';
    if (role === 'Owner') return 'Set up your owner account';
    return 'Create your account';
  }, [role]);

  const subtitle = useMemo(() => {
    if (role === 'Provider') {
      return 'Start your provider profile — same marketplace clients already browse.';
    }
    if (role === 'Owner') {
      return 'Manage listings, applications, and property operations in one place.';
    }
    return 'Save providers, book fixed-price jobs, and leave verified reviews.';
  }, [role]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const { access_token, profile } = await api.auth.register({
        email,
        password,
        full_name: fullName,
        role: toBackendRole(role),
      });
      setAuthSession(access_token, role);
      // profile is created by the DB trigger; keep a reference for future use.
      void profile;
      router.push(REGISTER_LANDING[role]);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-[24px] border border-[#efeff2] bg-white p-7 shadow-[0_12px_32px_rgba(14,42,72,0.08)] sm:p-9">
      <h2
        className="text-[26px] font-extrabold tracking-tight text-[#1b1b1f]"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        {title}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-[#5f6b76]">{subtitle}</p>

      <div
        role="tablist"
        aria-label="Account type"
        className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {ROLES.map((item) => {
          const active = role === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setRole(item.id)}
              className={`rounded-[16px] border px-3 py-3 text-left transition-all ${
                active
                  ? 'border-primary/40 bg-[#eeeffd] shadow-[0_1px_1px_rgba(99,106,232,0.2)]'
                  : 'border-[#efeff2] bg-[#fafafe] hover:border-[#c5cad3]'
              }`}
            >
              <span
                className={`block text-sm font-bold ${
                  active ? 'text-primary' : 'text-[#1b1b1f]'
                }`}
              >
                {item.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-[#8c97a2]">
                {item.blurb}
              </span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-[12px] border border-[#f5c6cb] bg-[#fdecee] px-4 py-3 text-sm font-medium text-[#a12b3b]"
        >
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field
          id="reg-name"
          label="Full name"
          type="text"
          placeholder="Amelia Whitlock"
          value={fullName}
          onChange={setFullName}
          autoComplete="name"
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
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-bold text-white shadow-[0_4px_12px_rgba(99,106,232,0.35)] transition-colors hover:bg-[#5258d4] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting
            ? 'Creating account…'
            : role === 'Provider'
              ? 'Continue to workspace'
              : role === 'Owner'
                ? 'Continue to owner dashboard'
                : 'Create account'}
        </button>
      </form>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-[#8c97a2]">
        By continuing you agree to TenantVoice Terms and acknowledge the Privacy
        Policy.
      </p>

      <p className="mt-5 text-center text-sm text-[#5f6b76]">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-primary hover:underline">
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
        className="mb-1.5 block text-xs font-bold tracking-wide text-[#8c97a2] uppercase"
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
        className="h-12 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 text-sm text-[#1b1b1f] outline-none transition-shadow placeholder:text-[#8c97a2] focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}
