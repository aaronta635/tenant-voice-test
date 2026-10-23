import { describe, expect, it, vi } from 'vitest';
import { renderMarkup } from '@/app/test-utils/static-markup';
import SearchPage from './page';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  redirect: (url: string) => { throw new Error(`redirect ${url}`); },
}));
// The results load in the browser; this covers the page around them.
vi.mock('@/app/components/public-profiles/ProfileSearch', () => ({ default: () => null }));

const open = (searchParams: Record<string, string>) => SearchPage({ searchParams: Promise.resolve(searchParams) });

describe('/search', () => {
  it('shows the profile search for the profile type, the default', async () => {
    const searches: Record<string, string>[] = [{}, { type: 'profiles', role: 'tenant', q: 'jane' }, { type: 'renter-profiles', q: 'Bondi' }];
    for (const params of searches) {
      const { headings, text } = renderMarkup(await open(params));
      expect(headings).toEqual(['h1 Find profiles']);
      expect(text).toMatch(/\blandlords\b/);
      expect(text).not.toMatch(/\bowners?\b/i);
    }
  });

  it('sends rental and service searches to their own pages with the text', async () => {
    await expect(open({ type: 'properties', q: 'Bondi' })).rejects.toThrow('redirect /properties?q=Bondi');
    await expect(open({ type: 'services', q: 'pest control' })).rejects.toThrow('redirect /categories?search=pest+control');
  });
});
