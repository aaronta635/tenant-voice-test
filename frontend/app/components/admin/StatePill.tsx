import type { ReactNode } from 'react';

export type PillTone = 'warning' | 'info' | 'danger' | 'success' | 'neutral';

const TONES: Record<PillTone, string> = {
  warning: 'border-warning text-warning',
  info: 'border-primary-strong text-primary-strong',
  danger: 'border-danger text-danger',
  success: 'border-success text-success',
  neutral: 'border-control-border text-text-body',
};

/** A state in words, outlined in its tone, as AccountStatusBadge shows an account's. */
export default function StatePill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border bg-white px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}
