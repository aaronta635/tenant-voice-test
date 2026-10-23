import { Suspense } from 'react';
import AdminAnalytics from '@/app/components/admin/AdminAnalytics';

export const metadata = { title: 'Analytics · Admin' };

/** /admin/analytics?days=: the range lives in the URL, read on the client. */
export default function AdminAnalyticsPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading analytics…</p>}>
      <AdminAnalytics />
    </Suspense>
  );
}
