import { Suspense } from 'react';
import AdminReviews from '@/app/components/admin/AdminReviews';

export const metadata = { title: 'Reviews · Admin' };

/** /admin/reviews?view=&page=: the queue's view lives in the URL, read on the client. */
export default function AdminReviewsPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading the queue…</p>}>
      <AdminReviews />
    </Suspense>
  );
}
