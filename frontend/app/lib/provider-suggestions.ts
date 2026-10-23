// Service providers suggested to the signed-in owner or tenant (backend
// GET /me/provider-suggestions, tracker R31): the providers the marketplace
// lists, ranked by where they work, their rating and how their price compares
// with the median for the same kind of price in their category, each with the
// facts behind its place (backend/app/services/provider_ranking.py).

import { apiFetch, type ProviderService } from './api';

/** How well a provider's areas fit: a suburb they name, then the postcode, then the state. */
export type SuggestionMatch = 'suburb' | 'postcode' | 'state';

export type ProviderSuggestion = {
  id: string;
  slug: string;
  display_name: string;
  category: string | null;
  category_name: string | null;
  /** Where the provider is based, as its marketplace card shows it. */
  location: string | null;
  state: string | null;
  verified: boolean;
  rating_avg: number | null;
  review_count: number;
  /** The live service the price is for, and the one the booking link opens; price 0 is not priced yet. */
  service: { id: string; title: string; pricing_type: ProviderService['pricing_type']; price: number };
  /** Null when too few providers of the category charge that way. */
  price_comparison: { median: number; position: 'below' | 'at' | 'above'; compared: number } | null;
  /** Null only when there is no place to match on. */
  match: SuggestionMatch | null;
  score: number;
  /** The facts behind its place, such as "4.8 from 12 reviews". */
  reasons: string[];
};

export type SuggestionContext = {
  /** property: one of the owner's; properties: all of them; profile: the caller's areas; none: nothing to match. */
  kind: 'property' | 'properties' | 'profile' | 'none';
  property_id: string | null;
  property_title: string | null;
  /** Each place as "Newtown, NSW 2042". */
  places: string[];
  /** The suburb a booking request starts with. */
  suburb: string | null;
};

export type ProviderSuggestions = {
  items: ProviderSuggestion[];
  context: SuggestionContext;
  category: { code: string; slug: string; name: string } | null;
  generated_at: string;
};

export type SuggestionQuery = {
  /** A category code or URL slug; empty for every category. */
  category?: string | null;
  /** Owners only: one of their properties (its listing id); empty for all of them. */
  propertyId?: string | null;
  limit?: number;
};

export function getProviderSuggestions({ category, propertyId, limit }: SuggestionQuery = {}): Promise<ProviderSuggestions> {
  return apiFetch<ProviderSuggestions>('/me/provider-suggestions', {
    query: { category, property_id: propertyId, limit },
  });
}

export function suggestionProfileHref(suggestion: Pick<ProviderSuggestion, 'id' | 'slug'>): string {
  return `/providers/${encodeURIComponent(suggestion.slug || suggestion.id)}`;
}

/** The provider page's booking form, with the suggested service chosen and the place's suburb filled in. */
export function suggestionBookingHref(suggestion: Pick<ProviderSuggestion, 'id' | 'slug' | 'service'>, suburb?: string | null): string {
  const params = new URLSearchParams({ service: suggestion.service.id });
  if (suburb) params.set('suburb', suburb);
  return `${suggestionProfileHref(suggestion)}?${params}#booking`;
}

/** "Newtown, NSW 2042; Glebe and 2 more": up to `shown` places, as a sentence lists them (a place has commas of its own). */
export function placeList(places: string[], shown = 3): string {
  if (places.length <= 1) return places.join('');
  if (places.length <= shown) return `${places.slice(0, -1).join('; ')} and ${places[places.length - 1]}`;
  const more = places.length - shown;
  return `${places.slice(0, shown).join('; ')} and ${more} more`;
}

/** Where the providers were ranked for, in words; null when there was no place to match. */
export function contextSentence(context: SuggestionContext): string | null {
  if (context.kind === 'none' || context.places.length === 0) return null;
  if (context.kind === 'property') return `${context.property_title ?? 'Your property'}, ${context.places[0]}`;
  if (context.kind === 'properties') {
    return context.places.length === 1 ? `your property in ${context.places[0]}` : `your properties in ${placeList(context.places)}`;
  }
  return placeList(context.places);
}

/** How the server orders the suggestions, in the words the pages show. */
export const RANKING_NOTE =
  'Ranked by where each provider works (a suburb its service areas name, then the postcode, then the state), its rating, and how its price compares with the median for the same kind of price (fixed, hourly or from) in its category. The verified badge breaks a tie.';
