import InspectionRecords from '@/app/components/inspections/InspectionRecords';
import OwnerInspectionTimes from '@/app/components/inspections/OwnerInspectionTimes';

export const metadata = { title: 'Inspections' };

/** Every listing's inspection times, requests and scheduled inspections (R13); (owner)/layout.tsx adds the shell. */
export default function OwnerInspectionsPage() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-dark sm:text-[30px]">Inspections</h1>
        <p className="mt-1 text-sm text-text-body">
          Requests for your inspection times and the inspections you scheduled. Publish times from a property&apos;s Inspections tab.
        </p>
      </div>
      <OwnerInspectionTimes />
      <InspectionRecords mode="owner" />
    </div>
  );
}
