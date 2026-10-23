'use client';

import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import StatCard from '@/app/components/ui/StatCard';
import { housingApi, type AggregateCell } from '@/app/lib/housing-api';
import HousingTable, { type HousingColumn } from './HousingTable';
import { useHousingData } from './use-housing-data';

const COLUMNS: HousingColumn<AggregateCell>[] = [
  { header: 'Suburb', value: (row) => row.area },
  { header: 'State', value: (row) => row.state },
  { header: 'Category', value: (row) => row.category },
  {
    header: 'Complaints',
    numeric: true,
    // A hidden count stays hidden in the file too.
    value: (row) => (row.suppressed ? 'suppressed' : row.count),
    cell: (row) => (row.suppressed ? <span className="text-text-body">Hidden<span className="sr-only"> (suppressed)</span></span> : row.count),
  },
];

/** Complaints about homes by suburb and category, with small counts suppressed on the server (GET /housing/aggregates). */
export default function HousingAggregates() {
  const { loading, data, error, retry } = useHousingData(housingApi.aggregates);

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="De-identified aggregates"
        description="Complaints about homes, counted by suburb and category. No names, emails or street addresses are included."
      />
      {loading ? (
        <p role="status" className="text-sm text-text-body">Loading the aggregates…</p>
      ) : !data ? (
        <LoadErrorCard title="Couldn't load the aggregates" message={error ?? undefined} onRetry={retry} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Suburbs" value={String(data.areas)} />
            <StatCard label="Hidden counts" value={String(data.suppressed_cells)} hint={`Counts under ${data.threshold}, and those that would reveal one`} />
          </div>
          <HousingTable
            title="Complaints by suburb and category"
            name="complaints-by-suburb"
            description={`A count under ${data.threshold} is hidden. Where a category would have only one hidden count, its next smallest is hidden too, so no count can be worked out from the category's total.`}
            columns={COLUMNS}
            rows={data.cells}
            rowKey={(row) => `${row.state}|${row.area}|${row.category_code}`}
            empty="No complaint is linked to a home yet."
          />
        </>
      )}
    </div>
  );
}
