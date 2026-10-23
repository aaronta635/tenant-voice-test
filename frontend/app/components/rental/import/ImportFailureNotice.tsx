import Button from '@/app/components/ui/Button';
import type { ImportFailure, ListingImport } from '@/app/lib/listing-import';

type Props = {
  failure: ImportFailure;
  /** Offered after a link failed: a PDF of the listing is the way round a site that cannot be read. */
  onChoosePdf?: () => void;
  /** Offered when the failure carries the sample of a site that refuses to be read. */
  onTrySample?: (sample: ListingImport) => void;
};

/**
 * Why an import failed and what to do instead (lib/listing-import's
 * importFailure). The wizard's form is untouched and stays editable, so the
 * owner can always type the details.
 */
export default function ImportFailureNotice({ failure, onChoosePdf, onTrySample }: Props) {
  const sample = onTrySample ? failure.sample : null;
  return (
    <div role="alert" className="rounded-xl border border-danger bg-white p-4 text-sm">
      <p className="font-semibold text-text-dark">{failure.title}</p>
      <p className="mt-1 break-words text-text-body">{failure.message}</p>
      {onChoosePdf || sample ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {onChoosePdf ? (
            <Button type="button" variant="secondary" size="sm" onClick={onChoosePdf}>
              Upload a PDF instead
            </Button>
          ) : null}
          {sample && onTrySample ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onTrySample(sample)}>
              Try a sample import (demo)
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
