import { LeaseList } from '@/app/components/leases/LeaseList';
import TenantShell from '@/app/components/tenant/TenantShell';
import PageHeader from '@/app/components/ui/PageHeader';

export const metadata = { title: 'Your leases' };

/** The tenant's leases (R26): each one to review, confirm and sign. */
export default function TenantLeasesPage() {
  return (
    <TenantShell>
      <main className="mx-auto flex w-full min-w-0 max-w-[1240px] flex-col gap-6 px-4 py-8 sm:px-6">
        <PageHeader title="Your leases" description="Review the lease your owner sends, confirm its terms and sign it." />
        <LeaseList role="tenant" />
      </main>
    </TenantShell>
  );
}
