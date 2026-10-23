import TenantLeaseView from '@/app/components/leases/TenantLeaseView';
import TenantShell from '@/app/components/tenant/TenantShell';

export const metadata = { title: 'Lease' };

export default async function TenantLeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <TenantShell>
      <main className="mx-auto w-full min-w-0 max-w-[1240px] px-4 py-8 sm:px-6">
        <TenantLeaseView leaseId={id} />
      </main>
    </TenantShell>
  );
}
