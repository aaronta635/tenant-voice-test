'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import DocumentStatusBadge from '@/app/components/documents/DocumentStatusBadge';
import Button from '@/app/components/ui/Button';
import FilterChip from '@/app/components/ui/FilterChip';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import Modal from '@/app/components/ui/Modal';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatDate } from '@/app/lib/format';
import {
  documentsApi,
  KIND_PHRASES,
  VISIBILITY_LABELS,
  type DocumentKind,
  type DocumentTypeInfo,
  type DocumentVisibility,
  type ProfileDocument,
} from '@/app/lib/profile-documents';
import { DOCUMENT_ACCEPT, documentFileProblem } from '@/app/lib/provider-workspace';

type Props = {
  type: DocumentTypeInfo;
  /** The saved document in this slot; null shows the type as not uploaded. */
  document: ProfileDocument | null;
  /** Whether the owner may share documents with the owners of listings they apply to. */
  canShare: boolean;
  onSaved: (document: ProfileDocument) => void;
  /** The panel says so: the card of a repeatable type goes with its document. */
  onDeleted: (document: ProfileDocument) => void;
};

type Confirmation = 'replace' | 'delete' | null;

/** The one slot a person names: "Other document (for example a payslip or contract)". */
const OTHER_TYPE = 'OTHER';

/** What failed, then why: the server's reason, or a plain retry. */
function failure(what: string, error: unknown) {
  return `${what} ${error instanceof ApiError ? error.message : 'Please try again.'}`;
}

/**
 * One document slot: its status, the file's name, and Upload, View, Replace
 * and Delete. A status changes only once the server has saved the change, so
 * a failed upload stays "Not uploaded". While an action runs the buttons stay
 * focusable (aria-disabled), and its result takes focus if focus was lost.
 */
export default function DocumentCard({ type, document, canShare, onSaved, onDeleted }: Props) {
  const id = useId();
  const card = useRef<HTMLDivElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ url: string; name: string } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [name, setName] = useState('');
  // What a new document is marked as, when its type offers marks.
  const [kind, setKind] = useState<DocumentKind | null>(null);
  const label = document?.label ?? type.label;
  // A new other document takes its name from the field above its upload button.
  const naming = !document && (type.repeatable || type.type === OTHER_TYPE);

  useEffect(() => {
    if (error || success || opened) focusResult(feedback.current, card.current);
  }, [error, success, opened]);

  async function run(action: () => Promise<string | null>, failed: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setOpened(null);
    try {
      const message = await action();
      if (message) setSuccess(message);
    } catch (err) {
      setError(failure(failed, err));
    } finally {
      setBusy(false);
    }
  }

  function chooseFile() {
    if (busy) return;
    setError(null);
    fileInput.current?.click();
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Picking the same file again must fire another change.
    event.target.value = '';
    if (!file) return;
    const problem = documentFileProblem(file);
    if (problem) {
      setSuccess(null);
      setError(`${problem} Nothing was uploaded.`);
      return;
    }
    if (document) {
      void run(async () => {
        onSaved(await documentsApi.replaceFile(document.id, file));
        return `${label}: ${file.name} uploaded. It is in review again.`;
      }, 'The new file was not uploaded.');
      return;
    }
    void run(async () => {
      const options = { label: naming ? name.trim() || undefined : undefined, ...(naming && kind ? { kind } : {}) };
      const saved = await documentsApi.upload(type.type, file, options);
      setName('');
      setKind(null);
      onSaved(saved);
      return `${saved.label}: ${file.name} uploaded. It is in review.`;
    }, 'The file was not uploaded.');
  }

  function view() {
    if (!document || busy) return;
    // Open the tab while the click still counts as the person's, so a
    // popup blocker allows it, then send it to the link once it is signed.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    void run(async () => {
      try {
        const { url } = await documentsApi.link(document.id);
        if (tab && !tab.closed) tab.location.href = url;
        else setOpened({ url, name: document.file_name ?? label });
        return null;
      } catch (err) {
        tab?.close();
        throw err;
      }
    }, 'The file could not be opened.');
  }

  function remove() {
    if (!document) return;
    setConfirmation(null);
    void run(async () => {
      await documentsApi.remove(document.id);
      onDeleted(document);
      return null;
    }, 'The document was not deleted.');
  }

  function share(visibility: DocumentVisibility) {
    if (!document || busy || visibility === document.visibility) return;
    void run(async () => {
      onSaved(await documentsApi.update(document.id, { visibility }));
      return visibility === 'private' ? `${label} is private again.` : `${label} may be shared with owners you apply to.`;
    }, 'Who can see this document was not changed.');
  }

  function mark(value: DocumentKind | null) {
    if (!document) {
      setKind(value);
      return;
    }
    if (busy || value === document.kind) return;
    void run(async () => {
      onSaved(await documentsApi.update(document.id, { kind: value }));
      return value ? `${label} is marked as ${KIND_PHRASES[value]}.` : `${label} is no longer marked.`;
    }, 'What this document is was not changed.');
  }

  function replace() {
    if (busy || !document) return;
    if (document.status === 'verified') setConfirmation('replace');
    else chooseFile();
  }

  const status = document?.status ?? 'missing';
  const availability = { 'aria-disabled': busy ? true : undefined } as const;
  const dated = document
    ? document.status === 'verified' && document.verified_at
      ? `Verified ${formatDate(document.verified_at)}`
      : `Submitted ${formatDate(document.submitted_at)}`
    : null;

  return (
    <div
      ref={card}
      className={`rounded-xl border bg-white p-4 sm:p-5 ${document ? 'border-primary/40' : 'border-border'}`}
      aria-labelledby={`${id}-title`}
      role="group"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${id}-title`} className="font-heading text-base font-semibold text-text-dark">{label}</h3>
            {type.required ? <span className="text-xs font-semibold text-text-body">Counts for verification</span> : null}
            {type.kept_only ? <span className="text-xs font-semibold text-text-body">No longer counts for verification</span> : null}
          </div>
          <p className="mt-1 text-sm text-text-body">{type.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-body">
            <DocumentStatusBadge status={status} />
            {document?.file_name ? <span className="min-w-0 break-all">{document.file_name}</span> : null}
            {dated ? <span>{dated}</span> : null}
          </div>
          {document?.status === 'rejected' ? (
            <p className="mt-2 text-sm text-danger">
              <span className="font-semibold">Not accepted: </span>
              {document.rejection_reason ?? 'The reviewer gave no reason.'} Replace the file to send it for review again.
            </p>
          ) : null}
          {document && !document.can_open && document.has_file ? (
            <p className="mt-2 text-sm text-text-body">This file was not uploaded on the website, so it can&apos;t be opened here.</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {document ? (
            <>
              {document.can_open ? (
                <Button variant="secondary" size="sm" {...availability} onClick={view}>
                  View<span className="sr-only"> {label}</span>
                </Button>
              ) : null}
              <Button
                variant={document.status === 'rejected' ? 'primary' : 'secondary'}
                size="sm"
                {...availability}
                onClick={replace}
              >
                {busy ? 'Working…' : 'Replace'}<span className="sr-only"> {label}</span>
              </Button>
              <Button variant="ghost" size="sm" className="text-danger hover:text-danger" {...availability} onClick={() => { if (!busy) setConfirmation('delete'); }}>
                Delete<span className="sr-only"> {label}</span>
              </Button>
            </>
          ) : type.kept_only ? null : (
            <Button size="sm" {...availability} onClick={chooseFile}>
              {busy ? 'Uploading…' : 'Upload'}<span className="sr-only"> {label}</span>
            </Button>
          )}
        </div>
      </div>

      {naming ? (
        <div className="mt-3 max-w-sm">
          <Input label="Name this document (optional)" maxLength={120} placeholder="Payslip, employment contract…" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
      ) : null}

      {type.kinds.length > 0 && (naming || document) ? (
        <div role="group" aria-labelledby={`${id}-kind`} className="mt-4 min-w-0">
          <p id={`${id}-kind`} className="text-xs font-semibold uppercase tracking-wide text-text-body">
            What it is<span className="sr-only">: {label}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[...type.kinds, { value: null, label: 'Something else' }].map((option) => (
              <FilterChip
                key={option.value ?? 'other'}
                selected={(document ? document.kind : kind) === option.value}
                className="whitespace-normal text-left"
                {...availability}
                onClick={() => mark(option.value)}
              >
                {option.label}
              </FilterChip>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-body">Payslips and employment contracts count toward your profile completion.</p>
        </div>
      ) : null}

      {document && canShare ? (
        <div role="group" aria-labelledby={`${id}-sharing`} className="mt-4 min-w-0">
          <p id={`${id}-sharing`} className="text-xs font-semibold uppercase tracking-wide text-text-body">
            Who can see it<span className="sr-only">: {label}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(VISIBILITY_LABELS) as DocumentVisibility[]).map((value) => (
              <FilterChip
                key={value}
                selected={document.visibility === value}
                className="whitespace-normal text-left"
                {...availability}
                onClick={() => share(value)}
              >
                {VISIBILITY_LABELS[value]}
              </FilterChip>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-body">
            A shared document goes with an application only when you choose it there. The listing&apos;s owner can
            then open it on the website while the application is open or approved. In the TenantVoice app, that owner
            can open all of your documents while the application is open or approved, whatever you choose here.
          </p>
        </div>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        aria-label={document ? `Replacement file for ${label}` : `File for ${label}`}
        tabIndex={-1}
        onChange={onFile}
      />
      <div ref={feedback} tabIndex={-1} className="mt-3">
        <FormMessage error={error} success={success} />
        {opened ? (
          <p className="text-sm">
            <a href={opened.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-strong underline">
              Open {opened.name}
            </a>{' '}
            <span className="text-text-body">(the link works for 5 minutes)</span>
          </p>
        ) : null}
      </div>

      <Modal
        open={confirmation !== null}
        title={confirmation === 'replace' ? `Replace your verified ${label.toLowerCase()}?` : `Delete ${label.toLowerCase()}?`}
        onClose={() => setConfirmation(null)}
        busy={busy}
        returnFocus={() => feedback.current}
      >
        <p className="text-sm text-text-body">
          {confirmation === 'replace'
            ? `The new file goes back to review, and this document no longer counts as verified until an admin approves it.${
              type.required ? ' Your account goes back to review too.' : ''}`
            : type.required
              ? 'The file is deleted from TenantVoice. Your verification needs it, so your account goes back to review until you upload it again and an admin approves it.'
              : 'The file is deleted from TenantVoice.'}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setConfirmation(null)}>Cancel</Button>
          {confirmation === 'replace' ? (
            <Button onClick={() => { setConfirmation(null); chooseFile(); }}>Choose the new file</Button>
          ) : (
            <Button variant="destructive" onClick={remove}>Delete document</Button>
          )}
        </div>
      </Modal>
    </div>
  );
}
