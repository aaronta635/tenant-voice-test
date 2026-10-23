import { mergeClasses } from '@/app/components/ui/merge-classes';

/**
 * Marks a review someone reported (FLAGGED) that no moderator has decided
 * yet. It stays up, and counts in the rating, until a moderator hides it.
 */
export default function ReportedBadge({ className }: { className?: string }) {
  return (
    <span className={mergeClasses('inline-block rounded-full bg-[#fdecee] px-2.5 py-1 text-xs font-bold text-[#a12b3b]', className)}>
      Reported · under review
    </span>
  );
}
