import { redirect } from 'next/navigation';
import { authPageHref } from '@/app/lib/auth-redirect';
import { getSessionRole } from '@/app/lib/session-role';

/**
 * Where the mobile functions' inspection notices link (mobile_inspection_notify
 * writes /inspections): each role's own inspections page.
 */
export default async function InspectionsPage() {
  const role = await getSessionRole();
  if (role === 'Owner') redirect('/owner/inspections');
  if (role === 'Client') redirect('/tenant/inspections');
  if (role === 'Provider') redirect('/dashboard');
  redirect(authPageHref('/login', null, '/inspections'));
}
