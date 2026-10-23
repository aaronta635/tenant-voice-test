'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Modal from '@/app/components/ui/Modal';

type Props = {
  open: boolean;
  title: string;
  /** What the decision does, and who is told, above the reason. */
  effect: ReactNode;
  confirmLabel: string;
  /** destructive for taking something down; primary otherwise. */
  tone?: 'destructive' | 'primary';
  /** Under the reason: where it goes. */
  reasonHelp: string;
  onClose: () => void;
  /**
   * Saves the decision. Resolves with a problem to show here, or with null
   * once it is done, when the opener closes the dialog. Give the dialog a key
   * per thing decided, so each opening starts empty.
   */
  onConfirm: (reason: string) => Promise<string | null>;
  /** Where focus goes when the dialog closes, if the button that opened it is gone. */
  returnFocus?: () => HTMLElement | null;
};

const REASON_REQUIRED = 'Give a reason. It is kept with the decision.';

/** A moderation decision with the reason it needs: kept with the admin's name and the time, and sent on. */
export default function ReasonDialog({ open, title, effect, confirmLabel, tone = 'destructive', reasonHelp, onClose, onConfirm, returnFocus }: Props) {
  const id = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const missingReason = error === REASON_REQUIRED;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!reason.trim()) {
      setError(REASON_REQUIRED);
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    let problem: string | null;
    try {
      problem = await onConfirm(reason.trim());
    } catch {
      problem = 'The decision was not saved. Please try again.';
    }
    if (problem) {
      setError(problem);
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={title} onClose={onClose} busy={busy} returnFocus={returnFocus}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="text-sm text-text-body">{effect}</div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-reason`} className="text-xs font-semibold uppercase tracking-wide text-text-body">
            Reason (required)
          </label>
          <textarea
            ref={reasonRef}
            id={`${id}-reason`}
            value={reason}
            onChange={(event) => { setReason(event.target.value); if (missingReason) setError(null); }}
            maxLength={500}
            rows={3}
            required
            aria-invalid={missingReason || undefined}
            aria-describedby={`${id}-reason-help`}
            className="w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
          />
          <p id={`${id}-reason-help`} className="text-xs text-text-body">{reasonHelp}</p>
        </div>
        <FormMessage error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant={tone} aria-disabled={busy || undefined}>
            {busy ? 'Saving…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
