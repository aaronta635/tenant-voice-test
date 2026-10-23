import { Suspense } from 'react';
import AdminVerification from '@/app/components/admin/AdminVerification';

export const metadata = { title: 'Verification · Admin' };

/** /admin/verification?role=&status=&page=: the queue's view lives in the URL, read on the client. */
export default function AdminVerificationPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading the queue…</p>}>
      <AdminVerification />
    </Suspense>
  );
}
