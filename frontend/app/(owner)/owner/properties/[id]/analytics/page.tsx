import { Suspense } from 'react';
import ListingAnalytics from '@/app/components/owner/ListingAnalytics';

/** /owner/properties/[id]/analytics?days=: the range lives in the URL, read on the client. */
export default function PropertyAnalyticsPage() {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading analytics…</p>}>
      <ListingAnalytics />
    </Suspense>
  );
}
