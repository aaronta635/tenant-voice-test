'use client';

import Link from 'next/link';
import { ChevronRightIcon } from '@/app/components/owner/icons';
import ProviderSuggestionList from '@/app/components/providers/ProviderSuggestionList';

/**
 * The owner dashboard's suggested providers (R31): the three the server
 * ranks best for all the owner's properties, and the way to the rest.
 */
export default function OwnerSuggestedProviders() {
  return (
    <section aria-labelledby="dashboard-provider-suggestions" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="dashboard-provider-suggestions" className="font-heading text-xl font-bold text-text-dark">Suggested providers</h2>
          <p className="mt-1 text-sm text-text-body">
            Providers who work where your properties are, rated well and priced fairly for their kind of price.
          </p>
        </div>
        <Link href="/owner/recommendations" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary-strong hover:underline">
          See all suggestions
          <ChevronRightIcon size={16} />
        </Link>
      </div>
      <ProviderSuggestionList
        limit={3}
        reasonsShown={3}
        noPlaceHint={
          <p>
            <Link href="/owner/properties/create" className="font-semibold text-primary-strong underline">Add a property</Link>{' '}
            to see the providers who work there first.
          </p>
        }
      />
    </section>
  );
}
