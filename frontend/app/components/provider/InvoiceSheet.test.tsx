import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InvoiceDocument } from '@/app/lib/api';
import InvoiceSheet from './InvoiceSheet';

const invoice = {
  id: 'invoice-1',
  number: 'INV-2026-0042',
  status: 'issued',
  amount: 256.2,
  created_at: '2026-10-20T01:00:00Z',
  issued_at: '2026-10-20T01:00:00Z',
  due_date: '2026-11-03',
  provider: { name: 'Harbour Plumbing', abn: '51 824 753 556', location: 'Newtown, NSW', phone: null },
  client: { name: 'Amelia Chen', location: 'Marrickville, NSW' },
  lines: [
    { description: 'Blocked drain', detail: 'Booked 18 Oct 2026', amount: 280 },
    { description: 'Platform fee', detail: null, amount: -23.8 },
  ],
} as InvoiceDocument;

describe('printed invoice', () => {
  const html = renderToStaticMarkup(<InvoiceSheet invoice={invoice} />);

  it('leaves the browser no page margin to print its page address and date in', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1].replace(/\s+/g, ' ');
    expect(style).toMatch(/@media print \{ @page \{[^}]*\bmargin: 0;/);
  });

  it('keeps a 15mm margin inside the invoice instead, on every printed page', () => {
    const classes = /<article[^>]*class="([^"]*)"/.exec(html)?.[1].split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['print:p-[15mm]', 'print:box-decoration-clone']));
    expect(classes).not.toContain('print:p-0');
  });

  it('still prints the invoice itself', () => {
    expect(html).toContain('INV-2026-0042');
    expect(html).toContain('$256.20');
  });
});
