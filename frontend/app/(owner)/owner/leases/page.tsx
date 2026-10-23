import { LeaseCandidates, LeaseList } from '@/app/components/leases/LeaseList';
import PageHeader from '@/app/components/ui/PageHeader';

export const metadata = { title: 'Leases' };

/** The owner's leases (R26): approved applications to draft one for, and the leases under way. */
export default function OwnerLeasesPage() {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        title="Leases"
        description="Draft a lease for an approved application, send its PDF, then sign and activate it once your tenant has signed."
      />
      <section aria-labelledby="ready-heading" className="flex min-w-0 flex-col gap-3">
        <h2 id="ready-heading" className="font-heading text-h4 font-semibold text-text-dark">Ready for a lease</h2>
        <LeaseCandidates />
      </section>
      <section aria-labelledby="leases-heading" className="flex min-w-0 flex-col gap-3">
        <h2 id="leases-heading" className="font-heading text-h4 font-semibold text-text-dark">Your leases</h2>
        <LeaseList role="owner" />
      </section>
    </div>
  );
}
