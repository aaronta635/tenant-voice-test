import type { ProviderSuggestion, ProviderSuggestions, SuggestionContext } from '@/app/lib/provider-suggestions';

/** A suggestion as GET /me/provider-suggestions sends it: a verified cleaner serving Newtown. */
export function suggestion(over: Partial<ProviderSuggestion> = {}): ProviderSuggestion {
  return {
    id: 'p-1', slug: 'sparkle-cleaning', display_name: 'Sparkle Cleaning', category: 'cleaner',
    category_name: 'Cleaning Provider', location: 'Marrickville', state: 'NSW', verified: true,
    rating_avg: 4.75, review_count: 4,
    service: { id: 's-1', title: 'Bond clean', pricing_type: 'flat', price: 120 },
    price_comparison: { median: 150, position: 'below', compared: 6 }, match: 'suburb', score: 93,
    reasons: ['Serves Newtown', '4.8 from 4 reviews', '$120 fixed, below the $150 median for cleaning', 'Verified by TenantVoice'],
    ...over,
  };
}

/** A whole answer; by default one suggestion for all of an owner's properties. */
export function suggestions(items: ProviderSuggestion[] = [suggestion()], context: Partial<SuggestionContext> = {},
  category: ProviderSuggestions['category'] = null): ProviderSuggestions {
  return {
    items,
    context: { kind: 'properties', property_id: null, property_title: null, places: ['Newtown, NSW 2042'], suburb: 'Newtown', ...context },
    category,
    generated_at: '2026-10-23T00:00:00Z',
  };
}
