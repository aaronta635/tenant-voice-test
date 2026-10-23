'use client';

import { useId, useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import { ApiError } from '@/app/lib/api';

type Props = {
  /** The statement the signer agrees to, as the server sent it. */
  consent: { text: string; version: string };
  /** The signer's name on their account, to start the field from. */
  suggestedName: string;
  submitLabel: string;
  busyLabel: string;
  /** Signs with the typed name; a rejection's message is shown. */
  onSign: (name: string) => Promise<void>;
};

/** A typed-name signature: the consent statement, the signer's full name and their agreement to it. */
export default function SignatureForm({ consent, suggestedName, submitLabel, busyLabel, onSign }: Props) {
  const id = useId();
  const [name, setName] = useState(suggestedName);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = name.split(/\s+/).filter(Boolean).join(' ');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (typed.length < 2 || typed.length > 160) {
      setError('Type your full name (2 to 160 characters).');
      return;
    }
    if (!agreed) {
      setError('Tick the box to agree to the statement before you sign.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSign(typed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The signature was not recorded. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
      <p id={`${id}-consent`} className="whitespace-pre-line break-words rounded-xl border border-border bg-surface p-4 text-sm text-text-dark">
        {consent.text}
      </p>
      <Input
        label="Type your full name to sign"
        autoComplete="name"
        maxLength={160}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label className="flex min-h-11 items-start gap-3 text-sm text-text-dark">
        <input
          type="checkbox"
          checked={agreed}
          aria-describedby={`${id}-consent`}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-primary-strong"
        />
        <span>I agree to the statement above and sign the lease electronically with the name I typed.</span>
      </label>
      <p className="text-xs text-text-body">
        TenantVoice records your typed name, the time and the PDF’s SHA-256 fingerprint. It is not a certified
        e-signature service.
      </p>
      <FormMessage error={error} />
      <Button type="submit" className="self-start" disabled={busy}>{busy ? busyLabel : submitLabel}</Button>
    </form>
  );
}
