'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import FilterChip from '@/app/components/ui/FilterChip';
import ProviderRecommendations from '@/app/components/provider/ProviderRecommendations';
import WorkOpportunities from '@/app/components/provider/WorkOpportunities';
import { setSearchParams } from '@/app/lib/page-url';

type View = 'people' | 'opportunities';

/**
 * The provider's two kinds of recommendation: people to connect with (the
 * assistant) and work opportunities (owners in the areas they serve), chosen
 * with ?view=opportunities. A view loads when first shown and then stays
 * mounted, so switching back keeps the assistant's conversation and results.
 */
export default function RecommendationViews() {
  const view: View = useSearchParams().get('view') === 'opportunities' ? 'opportunities' : 'people';
  const [opened, setOpened] = useState<View[]>([view]);
  if (!opened.includes(view)) setOpened([...opened, view]);

  const nav = (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Recommendations to show">
      <FilterChip selected={view === 'people'} onClick={() => setSearchParams({ view: null }, 'push')}>People to connect with</FilterChip>
      <FilterChip selected={view === 'opportunities'} onClick={() => setSearchParams({ view: 'opportunities' }, 'push')}>Work opportunities</FilterChip>
    </div>
  );

  return (
    <>
      {opened.includes('people') ? (
        <div hidden={view !== 'people'}>
          <ProviderRecommendations nav={nav} />
        </div>
      ) : null}
      {opened.includes('opportunities') ? (
        <div hidden={view !== 'opportunities'}>
          <WorkOpportunities nav={nav} />
        </div>
      ) : null}
    </>
  );
}
