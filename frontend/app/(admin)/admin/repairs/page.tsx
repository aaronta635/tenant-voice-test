import { Suspense } from 'react';
import AdminRepairs from '@/app/components/admin/AdminRepairs';

export const metadata = { title: 'Repairs · Admin' };

/** /admin/repairs?status=&priority=&q=&page=: the filters live in the URL, read on the client. */
export default function AdminRepairsPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading repairs…</p>}>
      <AdminRepairs />
    </Suspense>
  );
}
