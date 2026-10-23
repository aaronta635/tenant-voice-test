'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/app/components/ui/Button';
import PageHeader from '@/app/components/ui/PageHeader';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import EmptyState from '@/app/components/ui/EmptyState';
import InvoiceSheet from '@/app/components/provider/InvoiceSheet';
import { api, ApiError, type InvoiceDocument } from '@/app/lib/api';

/**
 * Printable invoice. "Download PDF" uses the browser's print-to-PDF; the
 * provider shell hides itself in print so only the invoice is saved.
 */
export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [invoiceState, setInvoiceState] = useState<{ id: string; invoice: InvoiceDocument } | null>(null);
  const invoice = invoiceState?.id === id ? invoiceState.invoice : null;
  const [error, setError] = useState<{ id: string; message: string; missing: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api.finance
      .invoiceDocument(id)
      .then((doc) => {
        if (!active) return;
        setInvoiceState({ id, invoice: doc });
        // Browsers use the page title as the default PDF file name.
        document.title = `${doc.number} · TenantVoice invoice`;
      })
      .catch((err) => {
        if (active) setError({ id, message: 'Could not load this invoice. Please try again.', missing: err instanceof ApiError && [404, 422].includes(err.status) });
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);

  if (error?.id === id) return <div className="space-y-5"><PageHeader title="Invoice" />{error.missing ? <EmptyState title="Invoice not found" description="This link may be incorrect or the invoice is no longer available." action={<Link className="font-semibold text-primary-strong underline" href="/dashboard/finances?section=invoices">Back to invoices</Link>} /> : <><LoadErrorCard message={error.message} onRetry={() => { setError(null); setAttempt(value => value + 1); }} /><Link className="inline-block font-semibold text-primary-strong underline" href="/dashboard/finances?section=invoices">Back to invoices</Link></>}</div>;
  if (!invoice) return <div className="space-y-5"><PageHeader title="Invoice" /><p role="status" className="text-text-body">Loading invoice…</p></div>;

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/dashboard/finances?section=invoices" className="text-sm font-semibold text-primary-strong">
          ← Back to invoices
        </Link>
        <Button type="button" onClick={() => window.print()}>
          Print / Save PDF
        </Button>
      </div>

      <p className="mb-4 text-sm text-text-body print:hidden">Choose “Save as PDF” in the print dialog. If your browser still adds the page address or print date, turn off headers and footers there.</p>

      <InvoiceSheet invoice={invoice} />
    </div>
  );
}
