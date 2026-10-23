import { Suspense } from 'react';
import RentStatement from './RentStatement';

export const metadata = { title: 'Rent statement' };

/** /owner/rent/print?listing=&tenant=&from=&to=: the ledger with these filters, laid out for paper or a PDF. */
export default function OwnerRentPrintPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading the statement…</p>}>
      <RentStatement />
    </Suspense>
  );
}
