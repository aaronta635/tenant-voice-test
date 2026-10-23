import ListingViewBeacon from '@/app/components/rental/ListingViewBeacon';
import PropertyDetail from '@/app/components/rental/PropertyDetail';

// (public)/layout.tsx supplies the chrome — the guest header, or the signed-in
// user's own role shell.
export default function PublicPropertyDetailPage() {
  return (
    <>
      <ListingViewBeacon />
      <PropertyDetail backHref="/properties" />
    </>
  );
}
