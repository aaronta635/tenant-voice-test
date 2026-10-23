'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/app/lib/api';
import { RESEND_COOLDOWN_SECONDS } from '@/app/lib/password-reset';

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;

type Props = {
  /** Heading and text above the email field, until a link is sent. */
  title: string;
  description: string;
  /** Move focus to the heading on mount, when this card replaces a form the user was in. */
  focusHeading?: boolean;
};

/**
 * Asks for a password reset email, then says to check the inbox. The wording
 * never says whether the address has an account: the API answers the same.
 */
export default function ResetLinkRequest({ title, description, focusHeading = false }: Props) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  // Focus follows the card when it swaps views, set by the handlers below.
  const pendingFocus = useRef<'heading' | 'email' | null>(focusHeading ? 'heading' : null);

  const coolingDown = secondsLeft > 0;
  useEffect(() => {
    if (!coolingDown) return;
    const timer = setInterval(() => setSecondsLeft((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(timer);
  }, [coolingDown]);

  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === 'heading') heading.current?.focus();
    if (target === 'email') emailField.current?.focus();
  });

  async function requestLink(address: string) {
    setError(null);
    setEmailInvalid(false);
    setNotice('');
    setSending(true);
    try {
      await api.auth.forgotPassword(address);
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    const address = email.trim();
    // The browser checks the field first; this covers the cases it lets through.
    if (!EMAIL_SHAPE.test(address)) {
      setError(address ? 'Enter a valid email address, like you@example.com.' : 'Enter your email address.');
      setEmailInvalid(true);
      emailField.current?.focus();
      return;
    }
    if (await requestLink(address)) {
      pendingFocus.current = 'heading';
      setSentTo(address);
    }
  }

  async function sendAnother() {
    if (!sentTo || sending || coolingDown) return;
    if (await requestLink(sentTo)) setNotice(`Another link is on its way to ${sentTo} if it has an account.`);
  }

  function changeEmail() {
    setError(null);
    setNotice('');
    pendingFocus.current = 'email';
    setSentTo(null);
  }

  const errorMessage = error ? (
    <p
      id="reset-request-error"
      role="alert"
      className="mt-5 rounded-[12px] border border-[#f5c6cb] bg-[#fdecee] px-4 py-3 text-sm font-medium text-[#a12b3b]"
    >
      {error}
    </p>
  ) : null;

  if (sentTo) {
    return (
      <div className="rounded-[24px] border border-[#efeff2] bg-white p-7 shadow-[0_12px_32px_rgba(14,42,72,0.08)] sm:p-9">
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-[26px] font-extrabold tracking-tight text-[#1b1b1f]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Check your email
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[#5f6b76]">
          If <strong className="font-semibold break-all text-[#1b1b1f]">{sentTo}</strong> has a TenantVoice
          account, we have sent it a link to reset the password. The link works once and expires after a
          short time.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[#5f6b76]">
          Nothing there? Check your spam folder, or send another link.
        </p>
        <p role="status" aria-live="polite" className={notice ? 'mt-3 text-sm font-medium text-success' : ''}>
          {notice}
        </p>
        {errorMessage}

        <button
          type="button"
          onClick={sendAnother}
          aria-disabled={sending || coolingDown || undefined}
          className="mt-6 flex h-12 w-full items-center justify-center rounded-full border border-primary-strong bg-white text-sm font-bold text-primary-strong transition-colors hover:bg-surface aria-disabled:cursor-not-allowed aria-disabled:border-[#c5cad3] aria-disabled:text-text-body aria-disabled:hover:bg-white"
        >
          {sending ? 'Sending link…' : coolingDown ? `Send another link in ${secondsLeft} s` : 'Send another link'}
        </button>
        <button
          type="button"
          onClick={changeEmail}
          className="mx-auto mt-3 block rounded-full px-3 py-2 text-sm font-semibold text-primary-strong hover:underline"
        >
          Use a different email
        </button>

        <p className="mt-5 text-center text-sm text-[#5f6b76]">
          <Link href="/login" className="font-semibold text-primary-strong hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-[#efeff2] bg-white p-7 shadow-[0_12px_32px_rgba(14,42,72,0.08)] sm:p-9">
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-[26px] font-extrabold tracking-tight text-[#1b1b1f]"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        {title}
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-[#5f6b76]">{description}</p>

      {errorMessage}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="reset-email"
            className="mb-1.5 block text-xs font-bold tracking-wide text-text-body uppercase"
          >
            Email
          </label>
          <input
            ref={emailField}
            id="reset-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            aria-invalid={emailInvalid || undefined}
            aria-describedby={emailInvalid ? 'reset-request-error' : undefined}
            className="h-12 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 text-sm text-[#1b1b1f] outline-none transition-shadow placeholder:text-text-body focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <button
          type="submit"
          disabled={sending}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-full border border-transparent bg-primary-strong text-sm font-bold text-white shadow-[0_4px_12px_rgba(99,106,232,0.35)] transition-colors hover:bg-navy disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? 'Sending link…' : 'Send reset link'}
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
