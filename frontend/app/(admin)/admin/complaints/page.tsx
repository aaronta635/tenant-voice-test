import { Suspense } from 'react';
import AdminComplaints from '@/app/components/admin/AdminComplaints';

export const metadata = { title: 'Complaints · Admin' };

/** /admin/complaints?status=&category=&assignee=&q=&page=: the filters live in the URL, read on the client. */
export default function AdminComplaintsPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading complaints…</p>}>
      <AdminComplaints />
    </Suspense>
  );
}
