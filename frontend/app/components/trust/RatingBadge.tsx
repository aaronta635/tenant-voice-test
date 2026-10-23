import { mergeClasses } from '@/app/components/ui/merge-classes';

type Props = {
  /** The API's average (two decimals); null or 0 with no reviews. */
  average: number | null | undefined;
  count: number | null | undefined;
  /** Where space allows, the count follows the score: "4.8 (25)". */
  showCount?: boolean;
  className?: string;
};

/** "Rated 4.8 out of 5 from 25 reviews": the whole badge, as a screen reader hears it. */
export function ratingDescription(average: number, count: number): string {
  return `Rated ${average.toFixed(1)} out of 5 from ${count.toLocaleString('en-AU')} review${count === 1 ? '' : 's'}`;
}

/**
 * The one rating badge for profiles (R23): a dark pill with a yellow star
 * and the average to one decimal, as the design reference draws it. Every
 * surface passes the API's figures as they are; the backend counts the same
 * reviews for every card and page (public_profiles.RATED_STATUSES).
 */
export default function RatingBadge({ average, count, showCount = true, className = '' }: Props) {
  if (!count || average === null || average === undefined) {
    return (
      <span className={mergeClasses('inline-flex shrink-0 items-center rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-text-body', className)}>
        No ratings yet
      </span>
    );
  }
  // The transparent border keeps the pill's outline in forced-colors mode, which drops its fill.
  return (
    <span className={mergeClasses('inline-flex shrink-0 items-center gap-1 rounded-full border border-transparent bg-navy px-2.5 py-0.5 text-xs font-bold text-white', className)}>
      <svg viewBox="0 0 20 20" className="size-3.5 shrink-0 text-[#facc15]" fill="currentColor" aria-hidden>
        <path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L10 14.8l-5.3 2.8 1.1-5.8L1.5 7.7l5.9-.8z" />
      </svg>
      <span aria-hidden>{average.toFixed(1)}</span>
      {showCount ? <span aria-hidden className="font-semibold">({count.toLocaleString('en-AU')})</span> : null}
      <span className="sr-only">{ratingDescription(average, count)}</span>
    </span>
  );
}
