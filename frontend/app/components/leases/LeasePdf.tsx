'use client';

import { useEffect, useState } from 'react';
import Button from '@/app/components/ui/Button';
import { ApiError } from '@/app/lib/api';
import { leasesApi } from '@/app/lib/leases';

type Props = { filename: string; title: string } & (
  | { blob: Blob; leaseId?: undefined; documentId?: undefined }
  | { blob?: undefined; leaseId: string; documentId: string }
);

/**
 * A lease PDF shown on the page, with links to open it full size and save it:
 * a preview's bytes, or a lease's latest PDF, which the backend streams to the
 * lease's two parties. It is never a Storage link. The page holds the PDF as a
 * blob URL, freed when another PDF replaces it or the page is left.
 */
export default function LeasePdf({ filename, title, blob, leaseId, documentId }: Props) {
  // What is shown is kept with the PDF it is for, so a new PDF never shows the old one's.
  const source = blob ?? `${leaseId}/${documentId}`;
  const [shown, setShown] = useState<{ source: Blob | string; url: string } | null>(null);
  const [failure, setFailure] = useState<{ source: Blob | string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    const pdf = blob ? Promise.resolve(blob) : leasesApi.pdf(leaseId as string, documentId as string);
    pdf.then(
      (data) => {
        if (!active) return;
        url = URL.createObjectURL(data);
        setShown({ source: blob ?? `${leaseId}/${documentId}`, url });
        setFailure(null);
      },
      (err) => {
        if (!active) return;
        setFailure({
          source: blob ?? `${leaseId}/${documentId}`,
          message: err instanceof ApiError ? err.message : 'The lease PDF could not be opened.',
        });
      },
    );
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob, leaseId, documentId, attempt]);

  const url = shown && shown.source === source ? shown.url : null;
  const failed = failure && failure.source === source ? failure.message : null;

  if (failed) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-danger p-4 text-sm text-danger">
        <p>{failed}</p>
        <Button variant="secondary" size="sm" onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}>
          Try again
        </Button>
      </div>
    );
  }
  if (!url) return <p role="status" className="rounded-xl bg-surface p-4 text-sm text-text-body">Loading the lease PDF…</p>;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <iframe src={url} title={title} className="h-[60vh] min-h-80 w-full rounded-xl border border-border bg-white" />
      <div className="flex flex-wrap gap-x-4 text-sm">
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
          Open the PDF in a new tab
        </a>
        <a href={url} download={filename} className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
          Save a copy
        </a>
      </div>
    </div>
  );
}
