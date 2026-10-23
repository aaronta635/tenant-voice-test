import { describe, expect, it } from 'vitest';
import { isPageRoute } from '@/app/test-utils/app-routes';
import { PROVIDER_MARKETPLACE_HREF, SEARCH_TYPES, searchHref } from './home-search';
import { PROFILE_ROLE_FILTERS, parseProfileSearch, profileSearchHref, searchTypeHref } from './public-profiles';

const url = (href: string) => new URL(href, 'https://tenantvoice.test');

describe('searchHref', () => {
  it('opens profile results for every role on the search page', () => {
    expect(searchHref('profiles', 'Jane')).toBe('/search?type=profiles&role=all&q=Jane');
  });

  it('can narrow profiles to one role', () => {
    expect(searchHref('profiles', 'Jane', 'landlord')).toBe('/search?type=profiles&role=landlord&q=Jane');
  });

  it('searches services on the provider marketplace with the parameter it reads', () => {
    expect(searchHref('services', 'bond clean')).toBe(`${PROVIDER_MARKETPLACE_HREF}?search=bond+clean`);
    expect(new URL(searchHref('services', 'bond clean'), 'https://tenantvoice.test').searchParams.get('search')).toBe('bond clean');
  });

  it('searches properties on the rentals page', () => {
    expect(searchHref('properties', 'Newtown')).toBe('/properties?q=Newtown');
  });

  it('opens each page unfiltered when the text is blank', () => {
    expect(searchHref('profiles', '   ')).toBe('/search?type=profiles&role=all');
    expect(searchHref('services', '')).toBe('/categories');
    expect(searchHref('properties', ' ')).toBe('/properties');
  });

  it('trims the text and encodes what a URL cannot hold', () => {
    const url = new URL(searchHref('properties', '  12/4 King St & Co #2 '), 'https://tenantvoice.test');
    expect(url.pathname).toBe('/properties');
    expect(url.searchParams.get('q')).toBe('12/4 King St & Co #2');
    expect(url.hash).toBe('');
  });

  it('offers the three types the homepage names, profiles first', () => {
    expect(SEARCH_TYPES.map((type) => type.label)).toEqual(['Profiles', 'Services', 'Properties']);
  });
});

describe('the homepage and /search agree on the URL', () => {
  it('opens /search on the profile search the homepage asked for', () => {
    for (const role of PROFILE_ROLE_FILTERS) {
      for (const text of ['', '  Jane Doe ', 'a&b=c #2']) {
        const href = searchHref('profiles', text, role);
        const search = { role, q: text.trim(), location: '', page: 1 };
        expect(href).toBe(profileSearchHref(search));
        expect(url(href).pathname).toBe('/search');
        expect(parseProfileSearch(url(href).searchParams)).toEqual(search);
        // /search shows a profile search itself rather than sending it on.
        expect(searchTypeHref(url(href).searchParams)).toBeNull();
      }
    }
  });

  it('sends a /search link for services or properties where the homepage search goes', () => {
    for (const type of ['services', 'properties'] as const) {
      for (const text of ['', ' bond clean ', 'a&b=c']) {
        expect(searchTypeHref({ type, q: text })).toBe(searchHref(type, text));
      }
    }
  });

  it('opens a page the app has for every search type', () => {
    for (const { value } of SEARCH_TYPES) {
      for (const text of ['', 'Newtown']) expect(isPageRoute(url(searchHref(value, text)).pathname)).toBe(true);
    }
  });
});
