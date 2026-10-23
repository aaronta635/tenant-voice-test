'use client';

import { useId, useState, type Ref } from 'react';
import FieldSourceChip from '@/app/components/rental/import/FieldSourceChip';
import SampleImportNotice from '@/app/components/rental/import/SampleImportNotice';
import VerificationRequired from '@/app/components/trust/VerificationRequired';
import Button from '@/app/components/ui/Button';
import {
  IMPORT_FIELDS,
  VIA_LABELS,
  WIZARD_STEPS,
  displayValue,
  fieldsWithValues,
  type ImportFieldKey,
  type ImportedField,
  type ListingImport,
} from '@/app/lib/listing-import';
import { refusalOf } from '@/app/lib/verification-gate';

type Props = {
  result: ListingImport;
  /** The fields the owner kept, in the wizard's order. */
  onUse: (chosen: ImportFieldKey[]) => void;
  onBack: () => void;
  /** The heading, which takes focus when the review opens (lib/focus-result). */
  headingRef?: Ref<HTMLHeadingElement>;
};

function counted(result: ListingImport) {
  const { found, inferred, missing } = result.counts;
  return `${found} found, ${inferred} inferred, ${missing} missing`;
}

/**
 * What an import read, field by field, before any of it goes into the
 * wizard: each value with its chip (found, inferred or missing) and the
 * snippet it came from. Every field with a value starts ticked; the owner
 * unticks what they don't want and confirms with "Use these details".
 * Nothing is saved here.
 */
export default function ImportReview({ result, onUse, onBack, headingRef }: Props) {
  const [chosen, setChosen] = useState<Set<ImportFieldKey>>(() => new Set(fieldsWithValues(result)));
  const headingId = useId();
  const refusal = refusalOf(result.verification);

  function toggle(key: ImportFieldKey) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const kept = IMPORT_FIELDS.map(({ key }) => key).filter((key) => chosen.has(key));

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div>
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-heading text-lg font-semibold text-text-dark">
          Check the imported details
        </h2>
        <p className="mt-1 break-words text-sm text-text-body">
          From <span className="font-semibold text-text-dark">{result.source_label}</span>: {counted(result)}. Untick
          anything you don&apos;t want. Nothing is saved until you publish the listing.
        </p>
      </div>
      {result.demo ? <SampleImportNotice /> : null}
      <p className="text-sm text-text-body">Photos are never copied from the listing. Add your own on the next step.</p>
      {refusal ? (
        <VerificationRequired detail={refusal} />
      ) : result.message ? (
        <p className="text-sm text-text-body">{result.message}</p>
      ) : null}

      {WIZARD_STEPS.map(({ step, label }) => (
        <section key={step} aria-labelledby={`${headingId}-${step}`}>
          <h3 id={`${headingId}-${step}`} className="text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body">
            {label}
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {IMPORT_FIELDS.filter((field) => field.step === step).map((field) => (
              <ReviewRow
                key={field.key}
                label={field.label}
                step={step === 'details' ? null : label}
                field={result.fields[field.key]}
                shown={displayValue(field.key, result.fields)}
                checked={chosen.has(field.key)}
                onToggle={() => toggle(field.key)}
              />
            ))}
          </ul>
        </section>
      ))}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          Start again
        </Button>
        <Button type="button" variant="primary" disabled={kept.length === 0} onClick={() => onUse(kept)}>
          Use these details
        </Button>
      </div>
    </section>
  );
}

type RowProps = {
  label: string;
  /** The later wizard step the field is on; null for this one. */
  step: string | null;
  field: ImportedField<unknown>;
  shown: string;
  checked: boolean;
  onToggle: () => void;
};

function ReviewRow({ label, step, field, shown, checked, onToggle }: RowProps) {
  const id = useId();
  if (field.source === 'missing') {
    return (
      <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border bg-white px-3 py-2">
        <span className="text-sm font-semibold text-text-dark">{label}</span>
        <FieldSourceChip source="missing" />
        <p className="w-full text-xs text-text-body">
          Not in the listing: type it in the form{step ? ` on the ${step} step` : ''}.
        </p>
      </li>
    );
  }
  const described = [`${id}-source`, `${id}-value`, field.evidence ? `${id}-evidence` : null].filter(Boolean).join(' ');
  return (
    <li className="rounded-xl border border-border bg-white px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <label className="flex min-h-11 min-w-0 items-center gap-3 text-sm font-semibold text-text-dark">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-describedby={described}
            className="size-5 shrink-0 accent-primary-strong"
          />
          {label}
        </label>
        <FieldSourceChip id={`${id}-source`} source={field.source} />
      </div>
      <p id={`${id}-value`} className="break-words text-sm text-text-dark">
        {shown}
      </p>
      {field.evidence ? (
        <p id={`${id}-evidence`} className="mt-1 break-words text-xs text-text-body">
          From the {field.via ? VIA_LABELS[field.via] : 'listing'}: &ldquo;{field.evidence}&rdquo;
          {field.source === 'inferred' ? (field.via === 'ai' ? ' Check it against the listing.' : ' Worked out from this, so check it.') : ''}
        </p>
      ) : null}
    </li>
  );
}
