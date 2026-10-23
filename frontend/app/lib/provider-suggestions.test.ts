import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./api', () => http);

import {
  contextSentence,
  getProviderSuggestions,
  placeList,
  suggestionBookingHref,
  suggestionProfileHref,
  type SuggestionContext,
} from './provider-suggestions';

const suggestion = { id: 'p-1', slug: 'sparkle-cleaning', service: { id: 's-1', title: 'Bond clean', pricing_type: 'flat' as const, price: 120 } };
const context = (over: Partial<SuggestionContext>): SuggestionContext => ({
  kind: 'profile', property_id: null, property_title: null, places: [], suburb: null, ...over,
});

beforeEach(() => http.apiFetch.mockReset().mockResolvedValue({ items: [], context: context({}), category: null, generated_at: '' }));

describe('getProviderSuggestions', () => {
  it('asks for the signed-in member\'s own suggestions, with the filters given', async () => {
    await getProviderSuggestions();
    await getProviderSuggestions({ category: 'cleaning-provider', propertyId: 'home-1', limit: 3 });

    expect(http.apiFetch.mock.calls).toEqual([
      ['/me/provider-suggestions', { query: { category: undefined, property_id: undefined, limit: undefined } }],
      ['/me/provider-suggestions', { query: { category: 'cleaning-provider', property_id: 'home-1', limit: 3 } }],
    ]);
  });
});

describe('suggestion links', () => {
  it('opens the provider page by its slug, or its id without one', () => {
    expect(suggestionProfileHref(suggestion)).toBe('/providers/sparkle-cleaning');
    expect(suggestionProfileHref({ id: 'p-1', slug: '' })).toBe('/providers/p-1');
    expect(suggestionProfileHref({ id: 'p-1', slug: 'a b/c' })).toBe('/providers/a%20b%2Fc');
  });

  it('opens the booking form with the suggested service and the place\'s suburb', () => {
    expect(suggestionBookingHref(suggestion, 'Newtown')).toBe('/providers/sparkle-cleaning?service=s-1&suburb=Newtown#booking');
    expect(suggestionBookingHref(suggestion, null)).toBe('/providers/sparkle-cleaning?service=s-1#booking');
    expect(suggestionBookingHref(suggestion, 'St Ives & Pymble')).toBe('/providers/sparkle-cleaning?service=s-1&suburb=St+Ives+%26+Pymble#booking');
  });
});

describe('suggestion wording', () => {
  it('lists places as a sentence does, a place keeping its own commas', () => {
    expect(placeList([])).toBe('');
    expect(placeList(['Newtown, NSW 2042'])).toBe('Newtown, NSW 2042');
    expect(placeList(['Newtown, NSW 2042', 'Glebe'])).toBe('Newtown, NSW 2042 and Glebe');
    expect(placeList(['A', 'B', 'C'])).toBe('A; B and C');
    expect(placeList(['A', 'B', 'C', 'D', 'E'])).toBe('A; B; C and 2 more');
  });

  it('says where the providers were ranked for', () => {
    expect(contextSentence(context({ kind: 'property', property_title: 'King St terrace', places: ['Newtown, NSW 2042'] })))
      .toBe('King St terrace, Newtown, NSW 2042');
    expect(contextSentence(context({ kind: 'properties', places: ['Newtown, NSW 2042'] }))).toBe('your property in Newtown, NSW 2042');
    expect(contextSentence(context({ kind: 'properties', places: ['Newtown, NSW 2042', 'Paddington, NSW 2021'] })))
      .toBe('your properties in Newtown, NSW 2042 and Paddington, NSW 2021');
    expect(contextSentence(context({ kind: 'profile', places: ['Glebe, NSW 2037', 'Newtown, NSW'] }))).toBe('Glebe, NSW 2037 and Newtown, NSW');
    expect(contextSentence(context({ kind: 'none' }))).toBeNull();
  });
});
