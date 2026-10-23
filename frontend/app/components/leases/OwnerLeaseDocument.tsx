'use client';

import { useId, useState, type FormEvent } from 'react';
import LeasePdf from '@/app/components/leases/LeasePdf';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import { ApiError } from '@/app/lib/api';
import { leasesApi, previewBlob, type Lease, type LeaseForm, type LeasePreview } from '@/app/lib/leases';

type Fields = {
  title: string;
  bond: string;
  paymentDetails: string;
  occupants: string;
  pets: '' | 'yes' | 'no';
  utilities: string;
  specialConditions: string;
};

const textArea =
  'w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark placeholder:text-text-subtle focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong';
const label = 'text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body';
const MAX_UPLOAD = 10 * 1024 * 1024;

function startFields(lease: Lease): Fields {
  return {
    title: 'Residential tenancy agreement',
    bond: lease.bond_amount !== null ? String(lease.bond_amount) : '',
    paymentDetails: '', occupants: '', pets: '', utilities: '', specialConditions: '',
  };
}

/** The form as the API takes it; null where it is left blank. */
function formOf(fields: Fields): LeaseForm | string {
  const bond = fields.bond.trim() ? Number(fields.bond) : null;
  if (bond !== null && (!Number.isFinite(bond) || bond < 0 || Math.abs(Math.round(bond * 100) - bond * 100) > 1e-6)) {
    return 'Enter the bond in dollars and cents, or leave it blank.';
  }
  const occupants = fields.occupants.trim() ? Number(fields.occupants) : null;
  if (occupants !== null && (!Number.isInteger(occupants) || occupants < 1 || occupants > 20)) {
    return 'Enter between 1 and 20 occupants, or leave it blank.';
  }
  const title = fields.title.split(/\s+/).filter(Boolean).join(' ');
  if (title.length < 3 || title.length > 120) return 'Give the lease a title of 3 to 120 characters.';
  const text = (value: string) => value.trim() || null;
  return {
    title,
    bond_amount: bond,
    payment_details: text(fields.paymentDetails),
    max_occupants: occupants,
    pets_allowed: fields.pets === '' ? null : fields.pets === 'yes',
    utilities: text(fields.utilities),
    special_conditions: text(fields.specialConditions),
  };
}

type Props = {
  lease: Lease;
  onSent: (lease: Lease, message: string) => void;
  /** A send the server refused because the lease moved on (409): the page shows its words and reloads the lease. */
  onRefused?: (message: string) => void;
};

/**
 * How the owner sends the lease PDF (R26): the guided form, previewed before
 * it is sent, or a PDF made elsewhere. What is sent is exactly the PDF
 * previewed: a change after the preview needs a new one, and the server
 * refuses a PDF whose hash is not the preview's.
 */
export default function OwnerLeaseDocument({ lease, onSent, onRefused }: Props) {
  const id = useId();
  const [fields, setFields] = useState<Fields>(() => startFields(lease));
  // A preview is kept with the form it was made from.
  const [preview, setPreview] = useState<{ form: string; preview: LeasePreview; blob: Blob } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'preview' | 'send' | 'upload' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = formOf(fields);
  const formKey = typeof form === 'string' ? null : JSON.stringify(form);
  const current = preview && preview.form === formKey ? preview : null;
  const replacing = lease.document !== null;

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((previous) => ({ ...previous, [key]: value }));
  }

  async function makePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (typeof form === 'string') {
      setError(form);
      return;
    }
    setBusy('preview');
    setError(null);
    try {
      const made = await leasesApi.preview(lease.id, form);
      setPreview({ form: JSON.stringify(form), preview: made, blob: previewBlob(made) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The preview could not be made. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!current || typeof form === 'string' || busy) return;
    setBusy('send');
    setError(null);
    try {
      const updated = await leasesApi.send(lease.id, form, current.preview.sha256);
      setPreview(null);
      onSent(updated, `The lease PDF was sent to ${lease.tenant.name}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setPreview(null);
        if (onRefused) {
          onRefused(err.message);
          return;
        }
      }
      setError(err instanceof ApiError ? err.message : 'The lease PDF was not sent. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      setError('Choose the PDF to send.');
      return;
    }
    if (file.type !== 'application/pdf' || file.size > MAX_UPLOAD) {
      setError('Choose a PDF of up to 10 MB.');
      return;
    }
    setBusy('upload');
    setError(null);
    try {
      const updated = await leasesApi.upload(lease.id, file);
      setFile(null);
      onSent(updated, `${file.name} was sent to ${lease.tenant.name}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && onRefused) {
        onRefused(err.message);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'The PDF was not sent. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {replacing ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-text-body">
          A new PDF replaces version {lease.document?.version} for {lease.tenant.name}: they review the new one instead.
        </p>
      ) : null}
      <form onSubmit={makePreview} noValidate className="flex min-w-0 flex-col gap-4" aria-labelledby={`${id}-guided`}>
        <h3 id={`${id}-guided`} className="font-heading text-lg font-semibold text-text-dark">Make the PDF from these details</h3>
        <p className="text-sm text-text-body">
          The PDF names you, {lease.tenant.name}, the address and the agreed rent and dates. Add the rest here.
        </p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Input label="Title" maxLength={120} value={fields.title} onChange={(event) => set('title', event.target.value)} />
          <Input label="Bond ($, optional)" type="number" inputMode="decimal" min={0} step="0.01" value={fields.bond}
            onChange={(event) => set('bond', event.target.value)} />
          <Input label="Most occupants (optional)" type="number" inputMode="numeric" min={1} max={20} step={1}
            value={fields.occupants} onChange={(event) => set('occupants', event.target.value)} />
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor={`${id}-pets`} className={label}>Pets</label>
            <select id={`${id}-pets`} value={fields.pets} onChange={(event) => set('pets', event.target.value as Fields['pets'])}
              className="min-h-11 w-full rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong">
              <option value="">Not set</option>
              <option value="yes">Allowed</option>
              <option value="no">Not allowed</option>
            </select>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={`${id}-payment`} className={label}>How to pay the rent (optional)</label>
          <textarea id={`${id}-payment`} rows={2} maxLength={500} value={fields.paymentDetails}
            onChange={(event) => set('paymentDetails', event.target.value)} className={textArea} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={`${id}-utilities`} className={label}>Utilities and other charges (optional)</label>
          <textarea id={`${id}-utilities`} rows={2} maxLength={1000} value={fields.utilities}
            onChange={(event) => set('utilities', event.target.value)} className={textArea} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={`${id}-conditions`} className={label}>Special conditions (optional)</label>
          <textarea id={`${id}-conditions`} rows={4} maxLength={4000} value={fields.specialConditions}
            onChange={(event) => set('specialConditions', event.target.value)} className={textArea} />
        </div>
        <Button type="submit" variant="secondary" className="self-start" disabled={busy !== null}>
          {busy === 'preview' ? 'Making the preview…' : current ? 'Preview again' : 'Preview the PDF'}
        </Button>
      </form>

      {preview && !current ? (
        <p role="status" className="rounded-xl border border-border bg-surface p-4 text-sm text-text-body">
          You changed the details after the preview. Preview the PDF again before you send it.
        </p>
      ) : null}
      {current ? (
        <section aria-label="Preview" className="flex min-w-0 flex-col gap-3">
          <LeasePdf blob={current.blob} filename={current.preview.filename} title="Preview of the lease PDF" />
          <Button className="self-start" disabled={busy !== null} onClick={send}>
            {busy === 'send' ? 'Sending…' : `Send this PDF to ${lease.tenant.name}`}
          </Button>
        </section>
      ) : null}

      <form onSubmit={upload} noValidate className="flex min-w-0 flex-col gap-3 border-t border-border pt-6">
        <h3 className="font-heading text-lg font-semibold text-text-dark">Or send a PDF you made elsewhere</h3>
        <label htmlFor={`${id}-file`} className={label}>Lease PDF (up to 10 MB)</label>
        <input id={`${id}-file`} type="file" accept="application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="min-h-11 w-full min-w-0 text-sm text-text-dark file:mr-3 file:min-h-10 file:rounded-lg file:border file:border-primary-strong file:bg-white file:px-3 file:text-primary-strong" />
        <Button type="submit" variant="secondary" className="self-start" disabled={busy !== null || !file}>
          {busy === 'upload' ? 'Sending…' : 'Send the uploaded PDF'}
        </Button>
      </form>

      <FormMessage error={error} />
    </div>
  );
}
