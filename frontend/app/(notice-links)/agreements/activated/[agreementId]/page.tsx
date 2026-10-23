import { redirect } from 'next/navigation';
import { leaseHref } from '@/app/(notice-links)/notice-links';

/** "Rental agreement activated" (notify_tenant_rent_agreement_activated): the tenant's lease page. */
export default async function LeaseActivatedNotice({ params }: { params: Promise<{ agreementId: string }> }) {
  const { agreementId } = await params;
  redirect(leaseHref('tenant', agreementId));
}
