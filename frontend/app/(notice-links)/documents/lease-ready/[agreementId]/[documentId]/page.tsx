import { redirect } from 'next/navigation';
import { leaseHref } from '@/app/(notice-links)/notice-links';

/** "Lease document ready for review" (notify_tenant_lease_document_ready): the tenant's lease page, at its latest PDF. */
export default async function LeaseReadyNotice({ params }: { params: Promise<{ agreementId: string; documentId: string }> }) {
  const { agreementId } = await params;
  redirect(leaseHref('tenant', agreementId));
}
