import TenantShell from '@/app/components/tenant/TenantShell';
import TenantComplaints from '@/app/components/complaints/TenantComplaints';

export const metadata = { title: 'Complaints' };

export default function TenantComplaintsPage() {
  return (
    <TenantShell>
      <main className="mx-auto w-full max-w-[900px] px-6 py-8">
        <TenantComplaints />
      </main>
    </TenantShell>
  );
}
