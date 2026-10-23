'use client';

import { useState, useSyncExternalStore } from 'react';
import Modal from './ui/Modal';
import { getSessionRecovery, subscribeToSessionRecovery, toBackendRole } from '@/app/lib/api';
import { parseRole } from '@/app/lib/session-role';

const serverSnapshot = () => null;

export default function SessionExpiredNotice() {
  const recovery = useSyncExternalStore(subscribeToSessionRecovery, getSessionRecovery, serverSnapshot);
  const [dismissedId, setDismissedId] = useState<number | null>(null);
  let loginHref: string | null = null;
  if (recovery && recovery.id !== dismissedId && typeof window !== 'undefined') {
    const params = new URLSearchParams({ reason: 'session-expired', next: window.location.pathname + window.location.search });
    // Without a known role, sign-in picks the account type from next instead.
    const role = parseRole(recovery.role);
    if (role) params.set('role', toBackendRole(role));
    loginHref = `/login?${params}`;
  }
  return <Modal open={!!loginHref} title="Sign in again to continue" onClose={() => setDismissedId(recovery?.id ?? null)}>
    <p className="text-text-body">Your session has expired. Your unsaved work is still in this tab. Sign in in a new tab, then return here and retry your last action.</p>
    <a href={loginHref ?? '/login'} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-primary-strong px-4 text-white">Sign in (new tab)</a>
  </Modal>;
}
