'use client';
import Link from 'next/link';
import { getAuthToken } from '@/app/lib/api';
import { getClientSessionRole, ROLE_HOME } from '@/app/lib/session-role';
import { useClientReady } from '@/app/lib/use-client-ready';
export default function ExistingSession() {
  const ready = useClientReady();
  const role = ready ? getClientSessionRole() : null;
  if (!ready || !getAuthToken() || !role) return null;
  return <p role="status" className="mt-4 rounded-xl border border-border p-3 text-sm text-text-body">You are already signed in. <Link className="font-semibold text-primary-strong underline" href={ROLE_HOME[role]}>Continue to your workspace</Link>.</p>;
}
