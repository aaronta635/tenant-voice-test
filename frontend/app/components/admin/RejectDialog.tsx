'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Modal from '@/app/components/ui/Modal';

type Props = {
  open: boolean;
  title: string;
  /** What is rejected and what follows, above the reason. */
  effect: ReactNode;
  confirmLabel: string;
  onClose: () => void;
  /**
   * Saves the rejection. Resolves with a problem to show here, or with null
   * once it is done, when the opener closes the dialog. Give the dialog a key
   * per thing rejected, so each opening starts empty.
   */
  onReject: (reason: string) => Promise<string | null>;
  /** Where focus goes when the dialog closes, if the button that opened it is gone. */
  returnFocus?: () => HTMLElement | null;
};

const REASON_REQUIRED = 'Give a reason. The person sees it with the decision.';

/** Reject a document or an account with the reason the person is told; the reason is required. */
export default function RejectDialog({ open, title, effect, confirmLabel, onClose, onReject, returnFocus }: Props) {
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
      problem = await onReject(reason.trim());
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
          <p id={`${id}-reason-help`} className="text-xs text-text-body">
            Sent to the person in a notification, and shown with the decision. Kept with your name and the time.
          </p>
        </div>
        <FormMessage error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="destructive" aria-disabled={busy || undefined}>
            {busy ? 'Saving…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
