import TenantShell from '@/app/components/tenant/TenantShell';
import ListingViewBeacon from '@/app/components/rental/ListingViewBeacon';
import PropertyDetail from '@/app/components/rental/PropertyDetail';

export default function TenantPropertyDetailPage() {
  return (
    <TenantShell>
      <main>
        <ListingViewBeacon />
        <PropertyDetail backHref="/tenant/properties" />
      </main>
    </TenantShell>
  );
}
