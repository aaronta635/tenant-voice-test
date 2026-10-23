import { cleanup, getByName, render, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceDocument } from '@/app/lib/api';
import Button from '@/app/components/ui/Button';
import InvoicePage from './page';

const invoice = {
  id: 'invoice-1', number: 'INV-2026-0042', status: 'issued', amount: 256.2,
  created_at: '2026-10-20T01:00:00Z', issued_at: '2026-10-20T01:00:00Z', due_date: '2026-11-03',
  provider: { name: 'Harbour Plumbing', abn: '51 824 753 556', location: 'Newtown, NSW', phone: null },
  client: { name: 'Amelia Chen', location: 'Marrickville, NSW' },
  lines: [{ description: 'Blocked drain', detail: 'Booked 18 Oct 2026', amount: 280 }],
} as InvoiceDocument;

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { finance: { invoiceDocument: async () => invoice } },
}));

afterEach(cleanup);

describe('invoice page actions', () => {
  it('print with the standard primary button and link back at AA contrast', async () => {
    const view = await render(<InvoicePage params={Promise.resolve({ id: 'invoice-1' })} />);
    const print = getByName(view, 'button', 'Print / Save PDF');
    const [standard] = (await render(<Button type="button">Print / Save PDF</Button>)).querySelectorAll('button');

    expect(print.className).toBe(standard.className);
    expect(getByName(view, 'a', '← Back to invoices').getAttribute('href')).toBe('/dashboard/finances?section=invoices');
    expect(lowContrastText(print.parentElement as FakeElement)).toEqual([]);
  });
});
