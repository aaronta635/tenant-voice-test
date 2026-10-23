import { mergeClasses } from '@/app/components/ui/merge-classes';
import { SOURCE_LABELS, type FieldSource } from '@/app/lib/listing-import';

const STYLES: Record<FieldSource, string> = {
  found: 'border-success text-success',
  inferred: 'border-warning text-warning',
  missing: 'border-control-border text-text-body',
};

/**
 * Where an imported field's value came from (lib/listing-import): found in
 * the listing, inferred from it, or missing. The word says it, not the
 * colour alone, and the outline stays in forced-colors mode.
 */
export default function FieldSourceChip({ source, id, className }: { source: FieldSource; id?: string; className?: string }) {
  return (
    <span
      id={id}
      className={mergeClasses(
        'inline-flex shrink-0 items-center rounded-full border bg-white px-2.5 py-0.5 text-xs font-semibold',
        STYLES[source],
        className,
      )}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}
