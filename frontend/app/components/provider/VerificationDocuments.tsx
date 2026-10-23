'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, type VerificationDocument } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatDate } from '@/app/lib/format';
import { DOCUMENT_ACCEPT, documentFileName, documentFileProblem } from '@/app/lib/provider-workspace';
import Modal from '@/app/components/ui/Modal';
import FormMessage from '@/app/components/ui/FormMessage';

const CREDENTIALS: { type: VerificationDocument['type']; label: string; fileOptional?: boolean }[] = [
  { type: 'id', label: 'Government ID' },
  { type: 'abn', label: 'ABN registration', fileOptional: true },
  { type: 'licence', label: 'Professional licence' },
  { type: 'insurance', label: 'Insurance' },
];
const STATUS = { pending: 'Pending review', verified: 'Verified', rejected: 'Rejected' };
const feedbackId = (type: string) => `credential-feedback-${type}`;
const rejectionId = (type: string) => `credential-rejection-${type}`;
// An admin's reason, as a sentence: "Blurred" from another app reads "Blurred." before what to do next.
const asSentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

type Props = { documents: VerificationDocument[]; onChange: (documents: VerificationDocument[]) => void; enabled?: boolean };

export default function VerificationDocuments({ documents, onChange, enabled = true }: Props) {
  const section = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The credential row the latest action was on; its result shows in that row.
  const [actionType, setActionType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<{ action: 'remove' | 'replace'; doc: VerificationDocument } | null>(null);

  // A result often swaps the button that was used (Upload becomes Replace,
  // Remove goes away), so move focus to the row's message, not the page body,
  // unless the provider has moved on to something outside this section.
  useEffect(() => {
    if (actionType && (error || success)) focusResult(document.getElementById(feedbackId(actionType)), section.current);
  }, [actionType, error, success]);

  function pickFile(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = window.document.createElement('input');
      input.type = 'file'; input.accept = DOCUMENT_ACCEPT;
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  async function run(type: string, action: () => Promise<void>) {
    if (!enabled || busy) return;
    setActionType(type);
    setError(null); setSuccess(null);
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save this credential. Try again.'); }
    finally { setBusy(null); }
  }

  async function upload(type: string) {
    const file = await pickFile();
    if (!file) return null;
    const problem = documentFileProblem(file);
    if (problem) throw new Error(problem);
    setBusy(type);
    // Check the provider before sending sensitive files to storage.
    await api.providers.mine();
    const uploaded = await api.uploads.verificationDocument(file);
    return { url: uploaded.url, name: file.name };
  }

  function add(type: VerificationDocument['type'], label: string, withFile: boolean) {
    return run(type, async () => {
      const file = withFile ? await upload(type) : null;
      if (withFile && !file) return;
      setBusy(type);
      await api.providers.mine();
      const created = await api.providers.addDocument({ type, label, document_url: file?.url ?? null });
      if (file) setNames((prev) => ({ ...prev, [created.id]: file.name }));
      onChange([created, ...documents]);
      setSuccess(`${label} submitted for review.`);
    });
  }

  function replace(doc: VerificationDocument) {
    return run(doc.type, async () => {
      const file = await upload(doc.type);
      if (!file) return;
      const updated = await api.providers.updateDocument(doc.id, { document_url: file.url });
      setNames((prev) => ({ ...prev, [doc.id]: file.name }));
      onChange(documents.map((d) => d.id === doc.id ? updated : d));
      setSuccess(`${doc.label ?? 'Credential'} replaced and submitted for review.`);
    });
  }

  async function confirm() {
    if (!confirmation) return;
    const { action, doc } = confirmation;
    setConfirmation(null);
    if (action === 'replace') { await replace(doc); return; }
    await run(doc.type, async () => {
      setBusy(doc.type);
      await api.providers.deleteDocument(doc.id);
      onChange(documents.filter((d) => d.id !== doc.id));
      setSuccess(`${doc.label ?? 'Credential'} removed.`);
    });
  }

  // While a credential saves, the buttons stay focusable (aria-disabled, not
  // disabled) so the browser does not drop focus from the one just pressed.
  const idleOnly = (action: () => void) => () => { if (!busy) action(); };
  const availability = { disabled: !enabled, 'aria-disabled': busy ? true : undefined } as const;

  return (
    <section ref={section} className="rounded-xl border border-border bg-white shadow-sm p-5">
      {/* Focusable so that links to #verification-documents move focus here. */}
      <h2 id="verification-documents" tabIndex={-1} className="font-bold text-text-dark">Verification documents</h2>
      <p className="mt-1 text-sm text-text-muted">Your files are private. Verified credentials show as badges on your public profile.</p>
      {!enabled ? <p className="mt-3 text-sm">Create your provider profile before uploading documents. <Link className="font-semibold text-primary-strong underline" href="/dashboard/onboarding">Start onboarding</Link></p> : null}
      <ul className="mt-4 divide-y divide-border">
        {CREDENTIALS.map((credential) => {
          const doc = documents.find((d) => d.type === credential.type);
          const working = busy === credential.type;
          const label = doc?.label || credential.label;
          // A rejected credential says why, beside the button that sends a new file for review.
          const rejected = doc?.status === 'rejected';
          return (
            <li key={credential.type} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-dark">{label}</p>
                <p className="mt-1 text-xs text-text-muted">{doc ? `${STATUS[doc.status]} · ${doc.status === 'verified' && doc.verified_at ? `Verified ${formatDate(doc.verified_at)}` : `Submitted ${formatDate(doc.created_at)}`}` : 'Not submitted'}</p>
                {rejected ? (
                  <p id={rejectionId(credential.type)} className="mt-1 break-words text-sm text-danger">
                    {doc.rejection_reason?.trim() ? <>Rejected: {asSentence(doc.rejection_reason)} </> : null}
                    {doc.document_url ? 'Replace the file' : 'Attach a file'} to send it for review again.
                  </p>
                ) : null}
                {doc?.document_url ? <a href={doc.document_url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-primary-strong underline">View {names[doc.id] ?? documentFileName(doc.document_url)}</a> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {doc ? <>
                  <button type="button" {...availability} aria-describedby={rejected ? rejectionId(credential.type) : undefined} onClick={idleOnly(() => doc.status === 'verified' ? setConfirmation({ action: 'replace', doc }) : void replace(doc))} className="min-h-11 rounded-lg border border-control-border px-3 text-sm font-semibold disabled:opacity-50 aria-disabled:opacity-50">{working ? 'Working…' : doc.document_url ? 'Replace file' : 'Attach file'}<span className="sr-only"> for {label}</span></button>
                  <button type="button" {...availability} onClick={idleOnly(() => setConfirmation({ action: 'remove', doc }))} className="min-h-11 rounded-lg border border-danger px-3 text-sm font-semibold text-danger disabled:opacity-50 aria-disabled:opacity-50">Remove<span className="sr-only"> {label}</span></button>
                </> : <>
                  {credential.fileOptional ? <button type="button" {...availability} onClick={idleOnly(() => void add(credential.type, credential.label, false))} className="min-h-11 rounded-lg border border-control-border px-3 text-sm font-semibold disabled:opacity-50 aria-disabled:opacity-50">Submit ABN</button> : null}
                  <button type="button" {...availability} onClick={idleOnly(() => void add(credential.type, credential.label, true))} className="min-h-11 rounded-lg border border-transparent bg-primary-strong px-4 text-sm font-bold text-white disabled:opacity-50 aria-disabled:opacity-50">{working ? 'Uploading…' : 'Upload file'}<span className="sr-only"> for {label}</span></button>
                </>}
              </div>
              {actionType === credential.type ? <div id={feedbackId(credential.type)} tabIndex={-1} className="sm:col-span-2"><FormMessage error={error} success={success} /></div> : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-text-muted">PDF, PNG, JPG or WebP, up to 5 MB.</p>
      <Modal open={!!confirmation} title={confirmation?.action === 'replace' ? 'Replace verified credential?' : 'Remove credential?'} onClose={() => setConfirmation(null)} busy={!!busy} returnFocus={() => (actionType ? document.getElementById(feedbackId(actionType)) : null)}>
        <p>{confirmation?.action === 'replace' ? 'The replacement goes back to the trust team for review. Your verified badge will be removed until approved.' : `${confirmation?.doc.label ?? 'This credential'} and its public badge will be removed.`}</p>
        <div className="mt-4 flex gap-2"><button type="button" className="min-h-11 rounded-lg border px-4" onClick={() => setConfirmation(null)}>Cancel</button><button type="button" className="min-h-11 rounded-lg border border-danger px-4 text-danger" onClick={() => void confirm()}>{confirmation?.action === 'replace' ? 'Choose replacement' : 'Remove credential'}</button></div>
      </Modal>
    </section>
  );
}
