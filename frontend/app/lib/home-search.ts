/**
 * The site-wide search contract, shared by the homepage search bar and the
 * public search page: each search type opens the page that lists its data.
 */

/** The provider marketplace: the header's "Find providers" and the homepage button open it. */
export const PROVIDER_MARKETPLACE_HREF = '/categories';

export type SearchType = 'profiles' | 'services' | 'properties';
export type ProfileRole = 'all' | 'tenant' | 'landlord' | 'provider';

export const SEARCH_TYPES: { value: SearchType; label: string; placeholder: string }[] = [
  { value: 'profiles', label: 'Profiles', placeholder: 'Tenants, landlords or providers' },
  { value: 'services', label: 'Services', placeholder: 'What do you need done?' },
  { value: 'properties', label: 'Properties', placeholder: 'Suburb, street or property name' },
];

/**
 * Where a search opens: profiles on /search (every role unless one is given),
 * services on the provider marketplace under its own `search` parameter, and
 * properties on the rentals page. Blank text opens the unfiltered page.
 * /search reads its URL back with lib/public-profiles and sends the other
 * types where this does.
 */
export function searchHref(type: SearchType, text: string, role: ProfileRole = 'all'): string {
  const query = text.trim();
  const params = new URLSearchParams();
  let path = '/properties';
  if (type === 'profiles') {
    path = '/search';
    params.set('type', 'profiles');
    params.set('role', role);
    if (query) params.set('q', query);
  } else if (type === 'services') {
    path = PROVIDER_MARKETPLACE_HREF;
    if (query) params.set('search', query);
  } else if (query) {
    params.set('q', query);
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}
