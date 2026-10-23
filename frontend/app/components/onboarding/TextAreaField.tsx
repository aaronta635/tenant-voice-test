'use client';

import type { ReactNode } from 'react';
import { CONTROL, HINT, LABEL } from '@/app/components/onboarding/styles';

type Props = {
  id: string;
  label: string;
  hint?: string;
  value: string;
  maxLength: number;
  rows?: number;
  placeholder?: string;
  onChange: (value: string) => void;
  /** Shown under the box and read out with it, such as a word count. */
  footer?: ReactNode;
};

/** A labelled textarea in the onboarding steps' style. */
export default function TextAreaField({ id, label, hint, value, maxLength, rows = 4, placeholder, onChange, footer }: Props) {
  const described = [hint ? `${id}-hint` : null, footer ? `${id}-footer` : null].filter(Boolean).join(' ');

  return (
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className={HINT}>
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-describedby={described || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={CONTROL}
      />
      {footer ? (
        <div id={`${id}-footer`} className={HINT}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
