'use client';

import { useId } from 'react';

type Props<T extends string> = {
  label: string;
  value: T | '';
  options: [T, string][];
  onChange: (value: T | '') => void;
  /** The first option, meaning no filter. */
  allLabel?: string;
};

/** A labelled filter select whose first option clears the filter. */
export default function AdminFilterSelect<T extends string>({ label, value, options, onChange, allLabel = 'All' }: Props<T>) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T | '')}
        className="min-h-11 w-full min-w-0 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
      >
        <option value="">{allLabel}</option>
        {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
      </select>
    </div>
  );
}
