import TenantInspections from '@/app/components/inspections/TenantInspections';
import TenantShell from '@/app/components/tenant/TenantShell';

export const metadata = { title: 'Inspections' };

export default function TenantInspectionsPage() {
  return (
    <TenantShell>
      <main className="mx-auto w-full min-w-0 max-w-[960px] px-4 py-8 sm:px-6">
        <TenantInspections />
      </main>
    </TenantShell>
  );
}
