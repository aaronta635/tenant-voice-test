import { mergeClasses } from '@/app/components/ui/merge-classes';
import { SCORECARD_STATUS_LABELS, SCORECARD_STATUS_STYLES, type ScorecardStatus } from '@/app/lib/scorecards';

/** Where a scorecard request is: pending, completed, declined or cancelled, in words as well as colour. */
export default function ScorecardStatusPill({ status, className = '' }: { status: ScorecardStatus; className?: string }) {
  return (
    <span className={mergeClasses(
      'inline-flex shrink-0 items-center rounded-full border bg-white px-2.5 py-0.5 text-xs font-semibold',
      SCORECARD_STATUS_STYLES[status],
      className,
    )}>
      {SCORECARD_STATUS_LABELS[status]}
    </span>
  );
}
