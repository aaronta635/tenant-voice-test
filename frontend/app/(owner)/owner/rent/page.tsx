import { Suspense } from 'react';
import RentLedgerView from './RentLedgerView';

export const metadata = { title: 'Rent ledger' };

/** /owner/rent?listing=&tenant=&from=&to=: the filters live in the URL, read on the client. */
export default function OwnerRentPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading the ledger…</p>}>
      <RentLedgerView />
    </Suspense>
  );
}
