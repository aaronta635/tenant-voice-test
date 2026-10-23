import TenantRent from '@/app/components/tenant/TenantRent';
import TenantShell from '@/app/components/tenant/TenantShell';

export const metadata = { title: 'My rent' };

export default function TenantRentPage() {
  return (
    <TenantShell>
      <main className="mx-auto w-full max-w-[900px] px-6 py-8">
        <TenantRent />
      </main>
    </TenantShell>
  );
}
