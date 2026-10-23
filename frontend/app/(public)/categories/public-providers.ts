import { api, type ProviderFilters, type PublicProvider } from '@/app/lib/api';

// GET /providers returns at most 100 providers per request.
const PAGE_SIZE = 100;

/**
 * Every published provider matching `filters`, one page at a time. The listing
 * pages filter and count on the client, so stopping at the first page would
 * hide every provider ranked after the 100th from searches and counts.
 */
export async function listAllPublicProviders(filters: Omit<ProviderFilters, 'limit' | 'offset'> = {}): Promise<PublicProvider[]> {
  const providers: PublicProvider[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await api.providers.listPublic({ ...filters, limit: PAGE_SIZE, offset });
    const fresh = page.filter((provider) => !seen.has(provider.id));
    for (const provider of fresh) {
      seen.add(provider.id);
      providers.push(provider);
    }
    // A short page is the last one; a page with nothing new means the offset was ignored.
    if (page.length < PAGE_SIZE || fresh.length === 0) return providers;
  }
}
