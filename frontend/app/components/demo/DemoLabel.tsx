import { mergeClasses } from '@/app/components/ui/merge-classes';

type DemoLabelProps = {
  /**
   * What is sample or simulated here. A pill reads it out after "Demo:" for
   * screen readers ("sample photo, not of this listing"); a notice shows it
   * as one or two sentences.
   */
  reason: string;
  /** `pill` sits inline beside the value it marks; `notice` is a block that shows the pill and the reason. */
  variant?: 'pill' | 'notice';
  className?: string;
};

// White on primary-strong is 7.24:1. Forced-colors mode and printing without
// backgrounds both drop the fill, so the border keeps the pill's outline and
// print turns the text dark.
const PILL = 'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-primary-strong bg-primary-strong px-2.5 py-1 text-xs font-bold text-white print:border-text-dark print:bg-white print:text-text-dark';

/**
 * Marks sample data or a feature that only works as a demo, so that nothing
 * passes for live (docs/demo-features.md lists every use). Either variant
 * reads "Demo: <reason>" to a screen reader.
 */
export default function DemoLabel({ reason, variant = 'pill', className }: DemoLabelProps) {
  if (variant === 'notice') {
    return (
      <div role="note" aria-label="Demo" data-demo-label="" className={mergeClasses('flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-surface px-4 py-3 text-sm text-navy', className)}>
        <span className={PILL}>Demo<span className="sr-only">: </span></span>
        {/* Under 12rem beside the pill, the reason wraps below it rather than into a narrow column. */}
        <p className="min-w-0 grow basis-48 break-words">{reason}</p>
      </div>
    );
  }
  return (
    <span data-demo-label="" className={mergeClasses(PILL, className)}>
      Demo<span className="sr-only">: {reason}</span>
    </span>
  );
}
