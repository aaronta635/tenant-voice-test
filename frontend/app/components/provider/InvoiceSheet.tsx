import DemoLabel from '@/app/components/demo/DemoLabel';
import type { InvoiceDocument } from '@/app/lib/api';
import { formatDate, formatMoneyExact } from '@/app/lib/format';

const STATUS_LABEL: Record<InvoiceDocument['status'], string> = {
  draft: 'Draft',
  issued: 'Awaiting payment',
  paid: 'Paid',
  void: 'Void',
};

// Browsers print their header and footer (page address, print date) in the
// page margin. A zero margin leaves them no room, so the invoice carries its
// own 15mm print padding instead, repeated on every printed page. This is a
// <style> element rather than global CSS so it applies only while an invoice
// is on screen: @page can't be scoped to a route any other way.
const PRINT_PAGE = '@media print { @page { size: A4; margin: 0; } }';

/** The printable invoice; "Print / Save PDF" prints just this sheet. */
export default function InvoiceSheet({ invoice }: { invoice: InvoiceDocument }) {
  const total = invoice.lines.reduce((sum, line) => sum + line.amount, 0);
  return (
    <>
      <style>{PRINT_PAGE}</style>
      <article className="rounded-[20px] border border-[#efeff2] bg-white p-8 print:rounded-none print:border-0 print:p-[15mm] print:box-decoration-clone">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs font-bold tracking-wide text-[#5f6b76] uppercase">Invoice</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[#1b1b1f]">{invoice.number}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="rounded-full border border-border bg-[#f4f4f8] px-2.5 py-1 text-xs font-bold text-[#0e2a48]">
                {STATUS_LABEL[invoice.status]}
              </p>
              {/* Prints with the invoice, which shows "Paid" though no money moved. */}
              <DemoLabel reason="simulated invoice, not proof of a real payment" />
            </div>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-[#5f6b76]">{invoice.status === 'draft' ? 'Created' : 'Issued'}</dt>
            <dd className="text-right font-semibold text-[#1b1b1f]">{formatDate(invoice.status === 'draft' ? invoice.created_at : invoice.issued_at)}</dd>
            <dt className="text-[#5f6b76]">Due</dt>
            <dd className="text-right font-semibold text-[#1b1b1f]">{formatDate(invoice.due_date)}</dd>
          </dl>
        </header>

        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold tracking-wide text-[#5f6b76] uppercase">From</p>
            <p className="mt-1 font-bold text-[#1b1b1f]">{invoice.provider.name ?? 'Service provider'}</p>
            {invoice.provider.abn ? <p className="text-sm text-[#5f6b76]">ABN {invoice.provider.abn}</p> : null}
            {invoice.provider.location ? <p className="text-sm text-[#5f6b76]">{invoice.provider.location}</p> : null}
            {invoice.provider.phone ? <p className="text-sm text-[#5f6b76]">{invoice.provider.phone}</p> : null}
          </div>
          <div>
            <p className="text-xs font-bold tracking-wide text-[#5f6b76] uppercase">Billed to</p>
            <p className="mt-1 font-bold text-[#1b1b1f]">{invoice.client.name ?? 'Client'}</p>
            {invoice.client.location ? <p className="text-sm text-[#5f6b76]">{invoice.client.location}</p> : null}
          </div>
        </section>

        <table className="mt-8 w-full table-fixed text-left text-sm">
          <thead className="border-b border-[#efeff2] text-xs tracking-wide text-[#5f6b76] uppercase">
            <tr>
              <th className="py-2 font-semibold">Description</th>
              <th className="w-32 py-2 text-right font-semibold">Amount (AUD)</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={index} className="border-b border-[#f4f4f8]">
                <td className="py-3 [overflow-wrap:anywhere]">
                  <p className="font-semibold text-[#1b1b1f]">{line.description}</p>
                  {line.detail ? <p className="text-xs text-[#5f6b76]">{line.detail}</p> : null}
                </td>
                <td className="whitespace-nowrap py-3 pl-3 text-right font-semibold text-[#1b1b1f]">{formatMoneyExact(line.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-4 text-right font-bold text-[#1b1b1f]">Total</td>
              <td className="pt-4 text-right text-lg font-extrabold text-[#1b1b1f]">{formatMoneyExact(total)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-10 text-xs text-[#5f6b76]">
          Generated from TenantVoice’s simulated ledger for a booked service. This document does not confirm a real payment. TenantVoice does not charge, hold or transfer money.
        </p>
      </article>
    </>
  );
}
