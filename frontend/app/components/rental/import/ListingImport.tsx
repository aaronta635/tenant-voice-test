'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import ImportFailureNotice from '@/app/components/rental/import/ImportFailureNotice';
import ImportReview from '@/app/components/rental/import/ImportReview';
import ImportSummary from '@/app/components/rental/import/ImportSummary';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FilterChip from '@/app/components/ui/FilterChip';
import Input from '@/app/components/ui/Input';
import { focusResult } from '@/app/lib/focus-result';
import {
  getImportSummary,
  importFailure,
  importListingFromPdf,
  importListingFromUrl,
  importedDraft,
  inputRefusal,
  linkToRead,
  saveImportSummary,
  summaryOf,
  type ImportFailure,
  type ImportFieldKey,
  type ImportSummary as Summary,
  type ListingImport as Imported,
} from '@/app/lib/listing-import';
import { getDraft, saveDraft, type ListingDraft } from '@/app/lib/owner-listing-draft';

type Mode = 'url' | 'pdf';

const MODES: [Mode, string][] = [['url', 'A link to the listing'], ['pdf', 'The listing as a PDF']];
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body';

type Props = {
  /** The draft fields the owner kept, for the page's form to show; they are in the saved draft already. */
  onUse: (details: Partial<ListingDraft>) => void;
};

/**
 * "Import from a link or PDF" on the create-listing wizard's first step
 * (R32). The server reads the listing (lib/listing-import); the review shows
 * each field found, inferred or missing, and only the fields the owner keeps
 * go into the draft, which nothing saves until the listing is published. A
 * failure says why and leaves the form as it was.
 */
export default function ListingImport({ onUse }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('url');
  const [link, setLink] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [useAi, setUseAi] = useState(false);
  const [reading, setReading] = useState(false);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [result, setResult] = useState<Imported | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const ids = useId();
  const entryId = `${ids}-entry`;
  const linkId = `${ids}-link`;
  const fileId = `${ids}-file`;
  const panelRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  // Each read, cancel and new import moves this on, so an answer that comes late is dropped.
  const attempt = useRef(0);
  // Set when an answer opens the review, which takes focus once it is on the page.
  const focusReview = useRef(false);

  useEffect(() => {
    // The summary lives beside the client-only draft in sessionStorage. It is
    // read after mount, as the page reads the draft, so the first render matches the server's.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSummary(getImportSummary());
  }, []);

  useEffect(() => {
    if (!result || !focusReview.current) return;
    focusReview.current = false;
    // After the review is committed: an answer's update can render after the next frame, so a
    // requestAnimationFrame callback may run while the review heading is not there yet.
    // Unless the owner moved on to the form below while the listing was read.
    focusResult(reviewRef.current, panelRef.current);
  }, [result]);

  function focusLater(target: () => HTMLElement | null) {
    requestAnimationFrame(() => target()?.focus());
  }

  const control = () => document.getElementById(mode === 'url' ? linkId : fileId);

  // The file input shows no file once it is put back on the page, so the file it held goes with it:
  // "Read the listing" never sends a PDF the form does not show.
  function dropFile() {
    setFile(null);
  }

  function openForm() {
    attempt.current += 1;
    setOpen(true);
    setFailure(null);
    focusLater(control);
  }

  function close() {
    attempt.current += 1;
    setOpen(false);
    setReading(false);
    setFailure(null);
    setResult(null);
    dropFile();
    focusLater(() => document.getElementById(entryId) ?? summaryRef.current);
  }

  function chooseMode(next: Mode) {
    if (next !== mode) dropFile();
    setMode(next);
    setFailure(null);
  }

  function choosePdf() {
    chooseMode('pdf');
    focusLater(() => document.getElementById(fileId));
  }

  function review(imported: Imported) {
    setFailure(null);
    setResult(imported);
    focusReview.current = true;
  }

  async function read(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reading) return;
    const refused = inputRefusal(mode, link, file);
    if (refused) {
      setFailure(refused);
      return;
    }
    const current = ++attempt.current;
    setReading(true);
    setFailure(null);
    try {
      const imported = mode === 'pdf' && file
        ? await importListingFromPdf(file, useAi)
        : await importListingFromUrl(linkToRead(link), useAi);
      if (current === attempt.current) review(imported);
    } catch (error) {
      if (current === attempt.current) setFailure(importFailure(error));
    } finally {
      if (current === attempt.current) setReading(false);
    }
  }

  function use(chosen: ImportFieldKey[]) {
    if (!result) return;
    const details = importedDraft(result, chosen, getDraft());
    saveDraft(details);
    onUse(details);
    const kept = summaryOf(result, chosen);
    saveImportSummary(kept);
    setSummary(kept);
    setResult(null);
    setOpen(false);
    dropFile();
    focusLater(() => summaryRef.current);
  }

  return (
    <div ref={panelRef} className="flex flex-col gap-4">
      {result ? (
        <Card className="p-4 sm:p-6">
          <ImportReview
            result={result}
            onUse={use}
            onBack={() => {
              setResult(null);
              dropFile();
              focusLater(control);
            }}
            headingRef={reviewRef}
          />
        </Card>
      ) : open ? (
        <Card className="p-4 sm:p-6">
          <h2 className="font-heading text-lg font-semibold text-text-dark">Import from a link or PDF</h2>
          <p className="mt-1 text-sm text-text-body">
            We read the listing and show you what we found before anything goes in the form. Photos are never
            copied: you add your own on the next step.
          </p>
          <form className="mt-4 flex flex-col gap-4" onSubmit={read} noValidate>
            <div role="group" aria-labelledby={`${ids}-mode`} className="flex min-w-0 flex-col gap-2">
              <p id={`${ids}-mode`} className={LABEL}>Import from</p>
              <div className="flex flex-wrap gap-2">
                {MODES.map(([value, label]) => (
                  <FilterChip key={value} selected={mode === value} disabled={reading} onClick={() => chooseMode(value)}>
                    {label}
                  </FilterChip>
                ))}
              </div>
            </div>

            {mode === 'url' ? (
              <Input
                id={linkId}
                label="Listing link"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://www.example.com/listing/123"
                value={link}
                disabled={reading}
                onChange={(event) => setLink(event.target.value)}
              />
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                <label htmlFor={fileId} className={LABEL}>
                  Listing PDF
                </label>
                <input
                  id={fileId}
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={reading}
                  aria-describedby={`${fileId}-hint`}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setFailure(null);
                  }}
                  className="block w-full min-w-0 text-sm text-text-body file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-primary-strong file:bg-white file:px-4 file:text-sm file:font-medium file:text-primary-strong"
                />
                <p id={`${fileId}-hint`} className="text-xs text-text-subtle">
                  Up to 10 MB. Most listing pages can be saved as a PDF with your browser&apos;s Print option.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="flex min-h-11 items-center gap-3 text-sm text-text-dark">
                <input
                  type="checkbox"
                  checked={useAi}
                  disabled={reading}
                  onChange={(event) => setUseAi(event.target.checked)}
                  aria-describedby={`${ids}-ai-hint`}
                  className="size-5 shrink-0 accent-primary-strong"
                />
                Also let AI read it for anything we miss
              </label>
              <p id={`${ids}-ai-hint`} className="text-xs text-text-subtle">
                For verified accounts. The listing&apos;s text is sent to our AI provider, and whatever it finds is
                marked inferred for you to check.
              </p>
            </div>

            <p role="status" aria-live="polite" className="text-sm text-text-body">
              {reading ? 'Reading the listing…' : ''}
            </p>
            {failure ? (
              <ImportFailureNotice failure={failure} onChoosePdf={mode === 'url' ? choosePdf : undefined} onTrySample={review} />
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={reading}>
                {reading ? 'Reading…' : 'Read the listing'}
              </Button>
            </div>
          </form>
        </Card>
      ) : summary ? (
        <ImportSummary summary={summary} onImportAgain={openForm} headingRef={summaryRef} />
      ) : (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <h2 className="font-heading text-lg font-semibold text-text-dark">Already listed elsewhere?</h2>
            <p className="mt-1 text-sm text-text-body">
              Fill this form from the listing&apos;s link or PDF. You check every detail before it goes in.
            </p>
          </div>
          <Button id={entryId} type="button" variant="secondary" className="shrink-0" onClick={openForm}>
            Import from a link or PDF
          </Button>
        </Card>
      )}
    </div>
  );
}
