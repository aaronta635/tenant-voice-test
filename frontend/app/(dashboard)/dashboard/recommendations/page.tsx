import { Suspense } from 'react';
import RecommendationViews from '@/app/components/provider/RecommendationViews';

export default function ProviderRecommendationsPage() {
  // The views read ?view=, and useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading recommendations…</p>}>
      <RecommendationViews />
    </Suspense>
  );
}
