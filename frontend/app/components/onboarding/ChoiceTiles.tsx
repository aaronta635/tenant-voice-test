'use client';

import { useId } from 'react';
import { HINT, LABEL } from '@/app/components/onboarding/styles';

type Props<T extends string> = {
  legend: string;
  hint?: string;
  options: { value: T; label: string }[];
  /** The chosen values, any number of them. */
  value: T[];
  onChange: (value: T[]) => void;
};

/**
 * A multiple choice as pill-shaped tiles, as the reference wizard shows its
 * chips, around real checkboxes: each tile is a label, so the box, the text
 * and the keyboard all work, and the box still shows in forced-colors mode.
 * Chosen values keep the order of the options.
 */
export default function ChoiceTiles<T extends string>({ legend, hint, options, value, onChange }: Props<T>) {
  const id = useId();

  function choose(option: T, on: boolean) {
    const chosen = new Set(value);
    if (on) chosen.add(option);
    else chosen.delete(option);
    onChange(options.map((item) => item.value).filter((item) => chosen.has(item)));
  }

  return (
    <fieldset className="min-w-0" aria-describedby={hint ? `${id}-hint` : undefined}>
      <legend className={LABEL}>{legend}</legend>
      {hint ? <p id={`${id}-hint`} className={HINT}>{hint}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = value.includes(option.value);
          return (
            <label
              key={option.value}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm text-text-dark ${
                checked ? 'border-primary-strong bg-surface font-semibold' : 'border-control-border bg-white'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => choose(option.value, event.target.checked)}
                className="size-4 shrink-0 accent-primary-strong"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
