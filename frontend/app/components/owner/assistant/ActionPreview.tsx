'use client';

import { useId } from 'react';
import DemoLabel from '@/app/components/demo/DemoLabel';
import VerificationRequired from '@/app/components/trust/VerificationRequired';
import Button from '@/app/components/ui/Button';
import type { OwnerAssistantAction } from '@/app/lib/owner-assistant';
import type { VerificationRequiredDetail } from '@/app/lib/verification-gate';

export type ActionState = 'pending' | 'confirming' | 'failed';

type Props = {
  action: OwnerAssistantAction;
  state?: ActionState;
  /** Why the last confirm failed: the action wrote nothing. */
  error?: string | null;
  gate?: VerificationRequiredDetail | null;
  onConfirm?: () => void;
  onCancel?: () => void;
};

/**
 * An action the owner assistant proposes (R30): every value it would write,
 * as the server worded them, and Confirm or Cancel. Nothing is written until
 * Confirm; Cancel sends nothing.
 */
export default function ActionPreview({ action, state = 'pending', error, gate, onConfirm, onCancel }: Props) {
  const headingId = useId();
  const { preview } = action;
  const busy = state === 'confirming';
  return (
    <section aria-labelledby={headingId} className="mt-3 rounded-xl border border-border bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-body">Suggested action, not done yet</p>
        {preview.demo ? <DemoLabel reason={preview.demo} /> : null}
      </div>
      <h2 id={headingId} className="mt-1 break-words font-heading text-base font-semibold text-text-dark">{preview.title}</h2>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        {preview.changes.map((change, index) => (
          <div key={`${change.label}-${index}`} className="contents">
            <dt className="font-semibold text-text-dark">{change.label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words text-text-body">{change.value}</dd>
          </div>
        ))}
      </dl>
      {preview.notes.map((note) => (
        <p key={note} className="mt-2 text-sm text-text-body">{note}</p>
      ))}
      <p className="mt-2 text-sm text-text-body">Nothing changes unless you confirm.</p>
      {gate ? <VerificationRequired detail={gate} className="mt-3" /> : null}
      {!gate && error ? (
        <p role="alert" className="mt-3 rounded-lg border border-danger p-3 text-sm text-danger">
          Nothing was changed. {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" onClick={onConfirm} disabled={busy}>
          {busy ? 'Confirming…' : 'Confirm'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
