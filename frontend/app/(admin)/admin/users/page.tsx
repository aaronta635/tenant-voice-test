import { Suspense } from 'react';
import AdminUsers from '@/app/components/admin/AdminUsers';

export const metadata = { title: 'Users · Admin' };

/** /admin/users?role=&status=&q=&page=: the filters live in the URL, read on the client. */
export default function AdminUsersPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading accounts…</p>}>
      <AdminUsers />
    </Suspense>
  );
}
