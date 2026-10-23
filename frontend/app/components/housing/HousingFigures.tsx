'use client';

import type { ReactNode } from 'react';
import type { CategoryStatuses, ComplaintSummary, Count } from '@/app/lib/housing-api';
import HousingTable, { type HousingColumn } from './HousingTable';

/** A breakdown (Count[]) as a two-column table with its CSV. */
export function CountTable({ title, name, label, rows, empty, description }: {
  title: string;
  name: string;
  /** The first column's header: Status, Severity, Rating. */
  label: string;
  rows: Count[];
  empty: string;
  description?: ReactNode;
}) {
  const columns: HousingColumn<Count>[] = [
    { header: label, value: (row) => row.label },
    { header: 'Count', value: (row) => row.count, numeric: true },
  ];
  return <HousingTable title={title} name={name} columns={columns} rows={rows} rowKey={(row) => row.key} empty={empty} description={description} />;
}

/** Complaints per category, one column per complaint status, from the real rows (GET /housing/complaints). */
export function ComplaintMatrix({ summary }: { summary: ComplaintSummary }) {
  const columns: HousingColumn<CategoryStatuses>[] = [
    { header: 'Category', value: (row) => row.label },
    ...summary.statuses.map((status): HousingColumn<CategoryStatuses> => ({
      header: status.label,
      numeric: true,
      value: (row) => row.statuses.find((count) => count.key === status.key)?.count ?? 0,
    })),
    { header: 'Total', value: (row) => row.total, numeric: true },
    { header: 'Median days to resolve', value: (row) => row.median_days_to_resolve, numeric: true },
  ];
  return (
    <HousingTable
      title="Complaints by category and status"
      name="complaints-by-category"
      description="Every complaint lodged on TenantVoice. Days to resolve count from lodging to resolution, over the complaints resolved or closed."
      columns={columns}
      rows={summary.categories}
      rowKey={(row) => row.code}
      empty="No complaints have been lodged yet."
    />
  );
}
