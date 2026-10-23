import type { Ref } from 'react';
import FieldSourceChip from '@/app/components/rental/import/FieldSourceChip';
import SampleImportNotice from '@/app/components/rental/import/SampleImportNotice';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import { IMPORT_FIELDS, WIZARD_STEPS, type ImportSummary as Summary } from '@/app/lib/listing-import';

type Props = {
  summary: Summary;
  onImportAgain: () => void;
  /** The heading, which takes focus once the details are in the form. */
  headingRef?: Ref<HTMLHeadingElement>;
};

/**
 * Which of the wizard's fields an import filled, kept on its first step
 * while the draft is in progress: every field marked found, inferred or
 * missing, by the step it is on, so the owner knows what to check and what
 * to type before publishing.
 */
export default function ImportSummary({ summary, onImportAgain, headingRef }: Props) {
  const labels = Object.fromEntries(IMPORT_FIELDS.map(({ key, label }) => [key, label]));
  const steps = Object.fromEntries(IMPORT_FIELDS.map(({ key, step }) => [key, step]));
  return (
    <Card className="p-6">
      <h2 ref={headingRef} tabIndex={-1} className="break-words font-heading text-lg font-semibold text-text-dark">
        Imported from {summary.source_label}
      </h2>
      {summary.demo ? <SampleImportNotice className="mt-3" /> : null}
      <p className="mt-2 text-sm text-text-body">
        The details you kept are in the form. Check each one on its step before you publish, and type in the
        missing ones. Photos were not copied.
      </p>
      <dl className="mt-4 flex flex-col gap-3">
        {WIZARD_STEPS.map(({ step, label }) => (
          <div key={step}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body">{label}</dt>
            <dd className="mt-1">
              <ul className="flex flex-wrap gap-2">
                {summary.fields.filter((field) => steps[field.key] === step).map((field) => (
                  <li
                    key={field.key}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-white py-1 pl-3 pr-1 text-xs text-text-dark"
                  >
                    {labels[field.key]}
                    {field.used || field.source === 'missing' ? (
                      <FieldSourceChip source={field.source} />
                    ) : (
                      <span className="rounded-full border border-control-border bg-white px-2.5 py-0.5 font-semibold text-text-body">
                        Not used
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
      <Button type="button" variant="secondary" className="mt-4" onClick={onImportAgain}>
        Import again
      </Button>
    </Card>
  );
}
