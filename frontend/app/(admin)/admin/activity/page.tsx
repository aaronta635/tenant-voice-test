import { Suspense } from 'react';
import AdminActivity from '@/app/components/admin/AdminActivity';

export const metadata = { title: 'Activity log · Admin' };

/** /admin/activity?log=&actor=&action=&entity=&from=&to=&page=: the filters live in the URL, read on the client. */
export default function AdminActivityPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading the activity log…</p>}>
      <AdminActivity />
    </Suspense>
  );
}
