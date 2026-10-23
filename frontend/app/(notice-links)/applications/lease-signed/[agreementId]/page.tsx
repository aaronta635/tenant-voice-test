import { redirect } from 'next/navigation';
import { leaseHref } from '@/app/(notice-links)/notice-links';

/** "Tenant electronically signed a lease" (notify_owner_of_tenant_lease_signature): the owner's lease page. */
export default async function LeaseSignedNotice({ params }: { params: Promise<{ agreementId: string }> }) {
  const { agreementId } = await params;
  redirect(leaseHref('owner', agreementId));
}
