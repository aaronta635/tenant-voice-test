type Row = { key: string; label: string; count: number };

/**
 * Counts by category or status as horizontal bars of one colour, each named
 * and valued in text beside it, so nothing rests on the bar alone. Rows keep
 * the order given (largest first for categories, the lifecycle for statuses).
 */
export default function BarList({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  const largest = Math.max(0, ...rows.map((row) => row.count));
  return (
    <figure className="min-w-0">
      <figcaption>
        <h3 className="font-heading text-base font-semibold text-text-dark">{title}</h3>
      </figcaption>
      {largest === 0 ? (
        <p className="mt-3 text-sm text-text-body">{empty}</p>
      ) : (
        <dl className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-3 text-sm sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
              <dt className="break-words text-text-body">{row.label}</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="block min-w-0 flex-1">
                  {/* Inline width: the bar's length is the data. */}
                  <span className="block h-3 rounded-r bg-primary-strong" style={{ width: `${(row.count / largest) * 100}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-text-dark">{row.count}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </figure>
  );
}
