'use client';

import DemoLabel from '@/app/components/demo/DemoLabel';
import { formatDate } from '@/app/lib/format';
import HousingTable, { type HousingColumn } from './HousingTable';

type Outcome = { reference: string; category: string; order: string; decided: string };

// Fictional examples: TenantVoice receives no tribunal outcomes yet. A feed of
// NCAT outcomes, kept in web.tribunal_outcomes, would replace them
// (docs/demo-features.md).
const SAMPLE_OUTCOMES: Outcome[] = [
  { reference: 'SAMPLE-001', category: 'Repairs', order: 'Landlord to repair the hot water system within 14 days; rent reduced by 20% until it is fixed.', decided: '2026-09-12' },
  { reference: 'SAMPLE-002', category: 'Bonds', order: 'Bond paid back to the tenant in full.', decided: '2026-08-28' },
  { reference: 'SAMPLE-003', category: 'Access and privacy', order: 'Landlord to give written notice before every entry, as the tenancy laws require.', decided: '2026-08-03' },
  { reference: 'SAMPLE-004', category: 'Termination', order: 'Termination notice found invalid; the tenancy continues.', decided: '2026-07-19' },
];

const COLUMNS: HousingColumn<Outcome>[] = [
  { header: 'Example', value: (row) => row.reference },
  { header: 'Category', value: (row) => row.category },
  { header: 'Order', value: (row) => row.order },
  { header: 'Decided', value: (row) => formatDate(row.decided) },
  { header: 'Source', value: () => 'Sample, not a real outcome', cell: () => <DemoLabel reason="sample outcome, not a real tribunal decision" /> },
];

/** Tribunal outcomes as clearly labelled examples, beside the real complaint statuses. */
export default function TribunalOutcomes() {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <DemoLabel
        variant="notice"
        reason="Sample tribunal outcomes: TenantVoice receives no NCAT decisions yet. These examples show how outcomes will appear beside the complaint statuses."
      />
      <HousingTable
        title="Tribunal outcomes (examples)"
        name="tribunal-outcomes-examples"
        columns={COLUMNS}
        rows={SAMPLE_OUTCOMES}
        rowKey={(row) => row.reference}
        empty="No examples."
      />
    </div>
  );
}
