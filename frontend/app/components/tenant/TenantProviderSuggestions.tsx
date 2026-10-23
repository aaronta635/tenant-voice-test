'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ProviderSuggestionList from '@/app/components/providers/ProviderSuggestionList';
import SuggestionFilter from '@/app/components/providers/SuggestionFilter';
import { api, type Category } from '@/app/lib/api';
import { PREFERENCES_HREF } from '@/app/lib/matching';
import { RANKING_NOTE } from '@/app/lib/provider-suggestions';

/**
 * Service providers for the tenant's own suburb and the suburbs they would
 * like to live in (R31), in one category or all, as the server ranks them.
 */
export default function TenantProviderSuggestions() {
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    let active = true;
    // The filter is a convenience: without the catalogue every category still shows.
    api.categories.list().then((rows) => { if (active) setCategories(rows); }).catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <section aria-labelledby="tenant-provider-suggestions" className="min-w-0 space-y-4">
      <div>
        <h2 id="tenant-provider-suggestions" className="text-lg font-bold text-text-dark">Service providers near you</h2>
        <p className="mt-1 text-sm leading-6 text-text-body">{RANKING_NOTE}</p>
      </div>
      <div className="sm:max-w-xs">
        <SuggestionFilter
          label="Category"
          value={category}
          allLabel="All categories"
          options={categories.map((item) => [item.slug, item.name])}
          onChange={setCategory}
        />
      </div>
      <ProviderSuggestionList
        category={category || null}
        onCategoryRefused={() => setCategory('')}
        noPlaceHint={
          <p>
            Add the suburbs you would like to live in to{' '}
            <Link href={PREFERENCES_HREF} className="font-semibold text-primary-strong underline">your preferences</Link>{' '}
            to see the providers who work there first.
          </p>
        }
      />
    </section>
  );
}
