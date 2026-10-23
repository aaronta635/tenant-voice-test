'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import ProviderSuggestionList from '@/app/components/providers/ProviderSuggestionList';
import SuggestionFilter from '@/app/components/providers/SuggestionFilter';
import { api, type Category, type Property } from '@/app/lib/api';
import { setSearchParams } from '@/app/lib/page-url';
import { RANKING_NOTE } from '@/app/lib/provider-suggestions';

type Options = { properties: Property[] | null; categories: Category[] };

/**
 * The owner's provider suggestions (R31): for all their properties, or the
 * one picked, in one category or all. The picks live in the URL (?property=,
 * ?category=), so a reload or Back keeps them.
 */
export default function OwnerProviderSuggestions() {
  // The filters read the URL, and useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={<p role="status" className="text-sm text-text-body">Loading provider suggestions…</p>}>
      <Suggestions />
    </Suspense>
  );
}

function Suggestions() {
  const searchParams = useSearchParams();
  const propertyId = searchParams.get('property') || null;
  const category = searchParams.get('category') || null;
  const [options, setOptions] = useState<Options>({ properties: [], categories: [] });

  useEffect(() => {
    let active = true;
    // The pickers are a convenience: without them every property and category still shows.
    Promise.all([
      api.properties.listMine().catch(() => null),
      api.categories.list().catch(() => [] as Category[]),
    ]).then(([properties, categories]) => { if (active) setOptions({ properties, categories }); });
    return () => { active = false; };
  }, []);

  return (
    <section aria-labelledby="owner-provider-suggestions" className="min-w-0 space-y-4">
      <div>
        <h2 id="owner-provider-suggestions" className="text-lg font-bold text-text-dark">Suggested providers</h2>
        <p className="mt-1 text-sm leading-6 text-text-body">{RANKING_NOTE}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
        <SuggestionFilter
          label="Property"
          value={propertyId ?? ''}
          allLabel="All my properties"
          options={(options.properties ?? []).map((home) => [home.id, [home.title, home.suburb].filter(Boolean).join(' · ')])}
          onChange={(value) => setSearchParams({ property: value || null })}
          hint={options.properties === null ? 'Your properties could not be loaded, so all of them are used.' : undefined}
        />
        <SuggestionFilter
          label="Category"
          value={category ?? ''}
          allLabel="All categories"
          options={options.categories.map((item) => [item.slug, item.name])}
          onChange={(value) => setSearchParams({ category: value || null })}
        />
      </div>
      <ProviderSuggestionList
        category={category}
        propertyId={propertyId}
        onPropertyGone={() => setSearchParams({ property: null })}
        onCategoryRefused={() => setSearchParams({ category: null })}
        noPlaceHint={
          <p>
            <Link href="/owner/properties/create" className="font-semibold text-primary-strong underline">Add a property</Link>, or
            your suburb on <Link href="/owner/profile/edit" className="font-semibold text-primary-strong underline">your profile</Link>,
            to see the providers who work there first.
          </p>
        }
      />
    </section>
  );
}
