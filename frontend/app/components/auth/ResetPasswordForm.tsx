'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ResetLinkRequest from '@/app/components/auth/ResetLinkRequest';
import { api, ApiError, clearAuthSession } from '@/app/lib/api';
import { MIN_PASSWORD_LENGTH, PASSWORD_UPDATED_LOGIN_HREF, recoveryTokenFrom } from '@/app/lib/password-reset';

type Stage =
  | { name: 'checking' }
  | { name: 'choosing'; token: string }
  | { name: 'expired'; afterSubmit: boolean }
  | { name: 'done' };

const CARD = 'rounded-[24px] border border-[#efeff2] bg-white p-7 shadow-[0_12px_32px_rgba(14,42,72,0.08)] sm:p-9';

/**
 * The page an emailed reset link opens. The recovery session's token arrives
 * in the URL fragment: it is read once, taken out of the address bar and kept
 * in memory only, never in storage.
 */
export default function ResetPasswordForm() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ name: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState({ password: false, confirm: false });
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const linkRead = useRef(false);

  useEffect(() => {
    function readLink() {
      const { hash, search, pathname } = window.location;
      const token = recoveryTokenFrom(hash, search);
      // Out of the address bar and this history entry before anything can copy or share it.
      if (hash || search) window.history.replaceState(null, '', pathname);
      setStage(token ? { name: 'choosing', token } : { name: 'expired', afterSubmit: false });
    }
    // A link opened again in this tab can change only the fragment, without a new page load.
    function onHashChange() {
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      if (['access_token', 'error', 'error_code'].some((key) => fragment.has(key))) readLink();
    }
    // Strict Mode runs effects twice in development; by the second run the fragment is gone.
    if (!linkRead.current) {
      linkRead.current = true;
      // The fragment exists only in the browser: read after mount so SSR and hydration agree.
      readLink();
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function refuse(field: string, message: string) {
    setError(message);
    setInvalidField(field);
    document.getElementById(field)?.focus();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || stage.name !== 'choosing') return;
    setError(null);
    setInvalidField(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      refuse('reset-password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (confirm !== password) {
      refuse('reset-confirm', 'The passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.auth.resetPassword({ access_token: stage.token, password });
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.status === 400) {
        setStage({ name: 'expired', afterSubmit: true });
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      return;
    }
    // The reset ended every session of the account; drop this browser's copy too.
    clearAuthSession();
    setStage({ name: 'done' });
    router.replace(PASSWORD_UPDATED_LOGIN_HREF);
    router.refresh();
  }

  if (stage.name === 'checking' || stage.name === 'done') {
    return (
      <div className={CARD}>
        <p role="status" className="text-sm text-[#5f6b76]">
          {stage.name === 'checking' ? 'Checking your reset link…' : 'Password updated. Taking you to sign in…'}
        </p>
      </div>
    );
  }

  if (stage.name === 'expired') {
    return (
      <ResetLinkRequest
        title="This link has expired or was already used"
        description="Reset links work once and expire after a short time. Enter your email and we will send you a new one."
        focusHeading={stage.afterSubmit}
      />
    );
  }

  return (
    <div className={CARD}>
      <h1
        className="text-[26px] font-extrabold tracking-tight text-[#1b1b1f]"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        Choose a new password
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-[#5f6b76]">
        Use at least {MIN_PASSWORD_LENGTH} characters. You will sign in with it next.
      </p>

      {error ? (
        <p
          id="reset-error"
          role="alert"
          className="mt-5 rounded-[12px] border border-[#f5c6cb] bg-[#fdecee] px-4 py-3 text-sm font-medium text-[#a12b3b]"
        >
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <PasswordField
          id="reset-password"
          label="New password"
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          value={password}
          onChange={setPassword}
          visible={visible.password}
          onToggle={() => setVisible((shown) => ({ ...shown, password: !shown.password }))}
          invalid={invalidField === 'reset-password'}
        />
        <PasswordField
          id="reset-confirm"
          label="Confirm new password"
          placeholder="Type it again"
          value={confirm}
          onChange={setConfirm}
          visible={visible.confirm}
          onToggle={() => setVisible((shown) => ({ ...shown, confirm: !shown.confirm }))}
          invalid={invalidField === 'reset-confirm'}
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-full border border-transparent bg-primary-strong text-sm font-bold text-white shadow-[0_4px_12px_rgba(99,106,232,0.35)] transition-colors hover:bg-navy disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Updating password…' : 'Update password'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[#5f6b76]">
        Remembered it?{' '}
        <Link href="/login" className="font-semibold text-primary-strong hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

/** A password input with a labelled Show/Hide button inside it. */
function PasswordField({
  id,
  label,
  placeholder,
  value,
  onChange,
  visible,
  onToggle,
  invalid,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggle: () => void;
  invalid: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-bold tracking-wide text-text-body uppercase"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'reset-error' : undefined}
          className="h-12 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] pr-20 pl-4 text-sm text-[#1b1b1f] outline-none transition-shadow placeholder:text-text-body focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-controls={id}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          className="absolute top-1/2 right-2 h-8 -translate-y-1/2 rounded-full px-3 text-xs font-semibold text-primary-strong transition-colors hover:bg-surface"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}
