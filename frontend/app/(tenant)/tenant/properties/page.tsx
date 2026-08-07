import TenantShell from '@/app/components/tenant/TenantShell';
import PropertyMarketplace from '@/app/components/rental/PropertyMarketplace';

export const metadata = {
  title: 'Properties - TenantVoice',
};

export default function TenantPropertiesPage() {
  return (
    <TenantShell>
      <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            Start renting
          </p>
          <h1 className="mt-2 font-heading text-[30px] font-semibold leading-9 tracking-tight">
            Find a property to inspect
          </h1>
          <p className="mt-1 text-sm text-[#565d6d]">
            Tenants can browse homes, compare price and photos, then click into a room or property detail.
          </p>
        </div>
        <PropertyMarketplace />
      </main>
    </TenantShell>
  );
}
