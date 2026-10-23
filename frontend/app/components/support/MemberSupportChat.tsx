'use client';

import SupportChat from '@/app/components/support/SupportChat';
import { getAuthToken } from '@/app/lib/api';
import { getClientSessionRole, getClientStaffRole, type SessionRole } from '@/app/lib/session-role';
import type { SupportAudience } from '@/app/lib/support-chat';
import { useClientReady } from '@/app/lib/use-client-ready';

const AUDIENCES: Record<SessionRole, SupportAudience> = {
  Client: 'tenant',
  Owner: 'landlord',
  Provider: 'service_provider',
};

/**
 * The support chat on a page visitors open too, such as /faqs, which is the
 * provider workspace's help page: shown to a signed-in member only, with
 * their role's example questions. The server checks the account on every
 * question; a visitor sees nothing here.
 */
export default function MemberSupportChat({ className }: { className?: string }) {
  const ready = useClientReady();
  if (!ready || !getAuthToken()) return null;
  const role = getClientSessionRole();
  const audience = getClientStaffRole() === 'Admin' ? 'admin' : role ? AUDIENCES[role] : undefined;
  return <SupportChat audience={audience} className={className} />;
}
