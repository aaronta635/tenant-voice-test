'use client';

import { LABEL } from '@/app/components/onboarding/styles';

type Props<T extends string> = {
  id: string;
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

/** A labelled native select in the onboarding steps' style. */
export default function SelectField<T extends string>({ id, label, options, value, onChange }: Props<T>) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="min-h-11 w-full rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
