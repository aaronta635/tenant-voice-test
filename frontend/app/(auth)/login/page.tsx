'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLE_HOME, type SessionRole } from '@/app/lib/session-role';
import { api, ApiError, setAuthSession, toSessionRole } from '@/app/lib/api';

type Role = SessionRole;

const ROLES: { id: Role; label: string; blurb: string }[] = [
  {
    id: 'Client',
    label: 'Client',
    blurb: 'Book inspectors, agents, tradies & more',
  },
  {
    id: 'Provider',
    label: 'Provider',
    blurb: 'Manage services, bookings & earnings',
  },
  {
    id: 'Owner',
    label: 'Owner',
    blurb: 'Manage properties, tenants & applications',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('Provider');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const cta = useMemo(
    () => (role === 'Provider' ? 'Sign in to workspace' : 'Sign in to continue'),
    [role],
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { access_token, profile } = await api.auth.login({ email, password });
      // The account's real role (from the DB) decides where we land — not the tab.
      const uiRole = toSessionRole(profile.role) ?? role;
      setAuthSession(access_token, uiRole);
      router.push(ROLE_HOME[uiRole]);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-[24px] border border-[#efeff2] bg-white p-7 shadow-[0_12px_32px_rgba(14,42,72,0.08)] sm:p-9">
      <div className="lg:hidden">
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">
          Welcome back
        </p>
      </div>

      <h2
        className="text-[26px] font-extrabold tracking-tight text-[#1b1b1f]"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        Sign in
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-[#5f6b76]">
        Use the same TenantVoice account you browse the marketplace with.
      </p>

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
              className="text-xs font-bold tracking-wide text-[#8c97a2] uppercase"
            >
              Password
            </label>
            <button
              type="button"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Forgot?
            </button>
          </div>
          <input
            id="login-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="h-12 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 text-sm text-[#1b1b1f] outline-none transition-shadow placeholder:text-[#8c97a2] focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-bold text-white shadow-[0_4px_12px_rgba(99,106,232,0.35)] transition-colors hover:bg-[#5258d4] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : cta}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[#5f6b76]">
        New here?{' '}
        <Link href="/register" className="font-semibold text-primary hover:underline">
          Create an account
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
