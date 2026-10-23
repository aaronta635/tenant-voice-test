import type { UpcomingInspection } from '@/app/lib/dashboards';
import { formatDateTime } from '@/app/lib/format';

/** Inspections still to come, soonest first: what, where, and when in Sydney time. */
export default function UpcomingInspectionList({ items, showListing = true }: {
  items: UpcomingInspection[];
  /** Off where the page is about one listing already. */
  showListing?: boolean;
}) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex min-w-0 flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <span className="min-w-0 break-words text-sm font-medium text-text-dark">
            {item.label}
            {showListing && item.listing_title ? (
              <span className="font-normal text-text-body"> · {item.listing_title}</span>
            ) : null}
          </span>
          <span className="shrink-0 text-sm text-text-body">{formatDateTime(item.starts_at)}</span>
        </li>
      ))}
    </ul>
  );
}
