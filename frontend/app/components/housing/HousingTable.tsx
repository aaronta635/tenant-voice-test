'use client';

import { useId, type ReactNode } from 'react';
import Button from '@/app/components/ui/Button';
import { csvFilename, downloadCsv, toCsv, type CsvValue } from '@/app/lib/csv';

export type HousingColumn<Row> = {
  header: string;
  /** What the CSV holds for the cell, and what the cell shows unless `cell` says otherwise. */
  value: (row: Row) => CsvValue;
  cell?: (row: Row) => ReactNode;
  /** Numbers line up on the right. */
  numeric?: boolean;
};

/** Downloads rows as a CSV of exactly these columns (lib/csv), named after the table and the Sydney date. */
export function CsvDownloadButton<Row>({ name, label, columns, rows }: {
  /** The file's name part: referrals gives housing-referrals-<date>.csv. */
  name: string;
  /** What is downloaded, for the button's accessible name: "Download CSV of referrals". */
  label: string;
  columns: HousingColumn<Row>[];
  rows: Row[];
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="print:hidden"
      onClick={() => downloadCsv(csvFilename(name), toCsv(columns.map(({ header, value }) => ({ header, value })), rows))}
    >
      Download CSV<span className="sr-only"> of {label}</span>
    </Button>
  );
}

function shown<Row>(column: HousingColumn<Row>, row: Row): ReactNode {
  if (column.cell) return column.cell(row);
  const value = column.value(row);
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

/**
 * A titled table of the portal's data with its CSV download. Narrow screens
 * scroll the table inside its own focusable region, never the page: the
 * region is positioned, so screen-reader-only text in a cell scrolled out of
 * view is clipped with it instead of widening the page.
 */
export default function HousingTable<Row>({ title, description, name, columns, rows, rowKey, empty }: {
  title: string;
  description?: ReactNode;
  /** The CSV file's name part (CsvDownloadButton). */
  name: string;
  columns: HousingColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Shown instead of the table when there are no rows. */
  empty: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="font-heading text-h4 font-semibold text-text-dark">{title}</h2>
          {description ? <div className="mt-1 text-sm text-text-body">{description}</div> : null}
        </div>
        {rows.length ? <CsvDownloadButton name={name} label={title.toLowerCase()} columns={columns} rows={rows} /> : null}
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-text-body">{empty}</p>
      ) : (
        <div
          role="region"
          // Its own name: the section is the heading's, and two regions with one name are two identical landmarks.
          aria-label={`${title} table`}
          tabIndex={0}
          className="relative mt-3 max-w-full overflow-x-auto rounded-lg border border-border bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-background text-xs uppercase tracking-wide text-text-body">
              <tr>
                {columns.map((column) => (
                  <th key={column.header} scope="col" className={`px-3 py-2 align-bottom font-semibold ${column.numeric ? 'text-right' : ''}`}>
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column, index) => {
                    const className = `px-3 py-2 align-top text-text-dark ${column.numeric ? 'text-right tabular-nums' : 'break-words'}`;
                    return index === 0 ? (
                      <th key={column.header} scope="row" className={`${className} font-medium`}>{shown(column, row)}</th>
                    ) : (
                      <td key={column.header} className={className}>{shown(column, row)}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
