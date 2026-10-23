import { Suspense } from 'react';
import AdminListings from '@/app/components/admin/AdminListings';

export const metadata = { title: 'Listings · Admin' };

/** /admin/listings?status=&q=&page=: the filters live in the URL, read on the client. */
export default function AdminListingsPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading listings…</p>}>
      <AdminListings />
    </Suspense>
  );
}
