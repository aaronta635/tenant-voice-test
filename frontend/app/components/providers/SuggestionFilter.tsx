'use client';

import { useId } from 'react';

type Props = {
  label: string;
  /** The chosen option's value; '' for the first option, which means no filter. */
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  allLabel: string;
  hint?: string;
};

/**
 * A labelled select over the provider suggestions. A value its options do
 * not hold (still loading, or gone) shows the first option until they do.
 */
export default function SuggestionFilter({ label, value, options, onChange, allLabel, hint }: Props) {
  const id = useId();
  const known = options.some(([option]) => option === value);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body">{label}</label>
      <select
        id={id}
        value={known ? value : ''}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full min-w-0 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
      >
        <option value="">{allLabel}</option>
        {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
      </select>
      {hint ? <p id={`${id}-hint`} className="text-xs text-text-body">{hint}</p> : null}
    </div>
  );
}
