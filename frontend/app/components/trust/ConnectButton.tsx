'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import FormMessage from '@/app/components/ui/FormMessage';
import { mergeClasses } from '@/app/components/ui/merge-classes';
import { ApiError } from '@/app/lib/api';
import { authPageHref } from '@/app/lib/auth-redirect';
import {
  getConnectionState,
  runConnectionAction,
  type ConnectionAction,
  type ConnectionState,
  type ConnectionStateName,
} from '@/app/lib/connections';
import { COUNTS_CHANGED_EVENT } from '@/app/lib/provider-refresh';

type Props = {
  /** The member's users.id. */
  userId: string;
  /** Their name as the page shows it, for the buttons' accessible names. */
  name: string;
  /** Signed out, the button is a sign-in link that comes back to returnTo. */
  signedIn: boolean;
  returnTo?: string;
  /** A list that already has the state (its search sends it) passes it, so the button reads nothing itself. */
  initialState?: ConnectionState;
  /** Shown beside "Connected", such as a Message button. */
  connectedAction?: ReactNode;
  /** Small full-width buttons, for a card in a list. */
  compact?: boolean;
  /** Told each state shown, so a frame around the button can follow it (nothing to offer on self or unavailable). */
  onState?: (state: ConnectionStateName) => void;
  className?: string;
};

const SUCCESS: Record<ConnectionAction, (name: string) => string> = {
  connect: (name) => `Request sent to ${name}.`,
  withdraw: () => 'Request withdrawn.',
  accept: (name) => `You and ${name} are now connected.`,
  decline: (name) => `Request declined. You can still send ${name} a request later.`,
};
const FAILURE: Record<ConnectionAction, string> = {
  connect: 'Could not send your request. Please try again.',
  withdraw: 'Could not withdraw your request. Please try again.',
  accept: 'Could not accept the request. Please try again.',
  decline: 'Could not decline the request. Please try again.',
};
// What a refused action means: the request changed since this page read it.
const STALE = new Set([400, 403, 404, 409]);

/**
 * Connect with a member from their profile (R24): Connect; Pending, with
 * Withdraw, once sent; Accept or Decline for a request they sent; Connected;
 * and nothing more for a request they declined (only they can ask again).
 * The server works out which applies (lib/connections), and shows nothing on
 * the viewer's own profile or for staff. Signed out, it asks the visitor to
 * sign in and come back.
 */
export default function ConnectButton({ userId, name, signedIn, returnTo, initialState, connectedAction, compact = false, onState, className = '' }: Props) {
  const [fetched, setFetched] = useState<ConnectionState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The state an action left, while the state it started from is still the one shown.
  const [acted, setActed] = useState<{ base: ConnectionState | null; state: ConnectionState } | null>(null);
  const [busy, setBusy] = useState<ConnectionAction | null>(null);
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Where focus goes once the decline question opens or closes: the button pressed is gone.
  const focusAfterToggle = useRef<'question' | 'decline' | null>(null);
  const reads = signedIn && !initialState;
  const base = initialState ?? (fetched?.user_id === userId ? fetched : null);
  const current = acted && acted.base === base ? acted.state : base;

  useEffect(() => {
    if (!reads) return;
    let active = true;
    getConnectionState(userId).then(
      (state) => { if (active) { setFetched(state); setLoadFailed(false); } },
      () => { if (active) setLoadFailed(true); },
    );
    return () => { active = false; };
  }, [reads, userId, attempt]);

  const shown = current?.state;
  useEffect(() => {
    if (shown) onState?.(shown);
  }, [shown, onState]);

  useEffect(() => {
    const target = focusAfterToggle.current;
    focusAfterToggle.current = null;
    if (target) containerRef.current?.querySelectorAll<HTMLElement>(target === 'question' ? 'p[data-decline-question]' : 'button[data-decline]')[0]?.focus();
  }, [confirmingDecline]);

  function toggleDecline(open: boolean) {
    focusAfterToggle.current = open ? 'question' : 'decline';
    setConfirmingDecline(open);
  }

  async function run(action: ConnectionAction) {
    if (!current || busy) return;
    const from = base;
    setBusy(action);
    setFeedback(null);
    try {
      setActed({ base: from, state: await runConnectionAction(action, current) });
      setFeedback({ success: SUCCESS[action](name) });
      window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT));
    } catch (error) {
      setFeedback({ error: error instanceof ApiError ? error.message : FAILURE[action] });
      // Answered or withdrawn elsewhere meanwhile: show what the request is now.
      if (error instanceof ApiError && STALE.has(error.status)) {
        await getConnectionState(userId).then((state) => setActed({ base: from, state }), () => undefined);
      }
    } finally {
      setBusy(null);
      setConfirmingDecline(false);
      // The button that was pressed has gone or changed, so focus moves to what happened.
      feedbackRef.current?.focus();
    }
  }

  if (!signedIn) {
    // Any account type can connect, so sign-in preselects none.
    return (
      <ButtonLink href={authPageHref('/login', null, returnTo ?? null)} size={compact ? 'sm' : 'md'} fullWidth={compact} className={className}>
        Sign in to connect
      </ButtonLink>
    );
  }
  if (!current) {
    return loadFailed ? (
      <div className={mergeClasses('text-sm', className)}>
        <p role="alert" className="text-danger">Could not check your connection with {name}.</p>
        <Button variant="ghost" size="sm" className="mt-1 px-0 font-semibold text-primary-strong underline" onClick={() => { setLoadFailed(false); setAttempt((value) => value + 1); }}>
          Try again
        </Button>
      </div>
    ) : (
      <p role="status" className={mergeClasses('text-sm text-text-body', className)}>Checking your connection…</p>
    );
  }
  if (current.state === 'self' || current.state === 'unavailable') return null;

  const size = compact ? 'sm' : 'md';
  const working = busy !== null;
  let controls: ReactNode;
  if (current.state === 'none') {
    controls = (
      <Button size={size} fullWidth={compact} disabled={working} aria-busy={busy === 'connect'} aria-label={`Connect with ${name}`} onClick={() => void run('connect')}>
        {busy === 'connect' ? 'Sending request…' : 'Connect'}
      </Button>
    );
  } else if (current.state === 'sent') {
    controls = (
      <>
        <p className="text-sm font-semibold text-text-dark">Pending: request sent</p>
        <Button variant="secondary" size={size} fullWidth={compact} disabled={working} aria-busy={busy === 'withdraw'} aria-label={`Withdraw your request to ${name}`} onClick={() => void run('withdraw')}>
          {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
        </Button>
      </>
    );
  } else if (current.state === 'received' && confirmingDecline) {
    controls = (
      <>
        <p data-decline-question="" tabIndex={-1} className="text-sm text-text-dark">Decline {name}&apos;s request? After that, only you can send a new one.</p>
        <Button variant="destructive" size={size} fullWidth={compact} disabled={working} aria-busy={busy === 'decline'} onClick={() => void run('decline')}>
          {busy === 'decline' ? 'Declining…' : 'Decline request'}
        </Button>
        <Button variant="ghost" size={size} fullWidth={compact} disabled={working} onClick={() => toggleDecline(false)}>
          Keep request
        </Button>
      </>
    );
  } else if (current.state === 'received') {
    controls = (
      <>
        <p className="text-sm font-semibold text-text-dark">{name} wants to connect</p>
        <Button size={size} fullWidth={compact} disabled={working} aria-busy={busy === 'accept'} aria-label={`Accept ${name}'s request`} onClick={() => void run('accept')}>
          {busy === 'accept' ? 'Accepting…' : 'Accept'}
        </Button>
        <Button variant="secondary" size={size} fullWidth={compact} disabled={working} data-decline="" aria-label={`Decline ${name}'s request`} onClick={() => toggleDecline(true)}>
          Decline
        </Button>
      </>
    );
  } else if (current.state === 'connected') {
    controls = (
      <>
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0" aria-hidden>
            <path d="m4.5 10.5 3.5 3.5 7.5-8" />
          </svg>
          Connected
        </p>
        {connectedAction}
      </>
    );
  } else {
    controls = <p className="text-sm text-text-body">{name} declined your request.</p>;
  }

  return (
    <div ref={containerRef} className={mergeClasses(compact ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-3', className)}>
      {controls}
      <div ref={feedbackRef} tabIndex={-1} className={feedback ? 'w-full' : 'sr-only'}>
        <FormMessage error={feedback?.error} success={feedback?.success} />
      </div>
    </div>
  );
}
