import OwnerLeaseView from '@/app/components/leases/OwnerLeaseView';

export const metadata = { title: 'Lease' };

export default async function OwnerLeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerLeaseView leaseId={id} />;
}
