import { cleanup, click, descendants, dispatch, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Category } from '@/app/lib/api';
import { suggestion, suggestions } from '@/app/test-utils/provider-suggestions';
import TenantProviderSuggestions from './TenantProviderSuggestions';

const mocks = vi.hoisted(() => ({ suggestions: vi.fn(), categories: vi.fn() }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { categories: { list: mocks.categories } },
}));
vi.mock('@/app/lib/provider-suggestions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/provider-suggestions')>()),
  getProviderSuggestions: mocks.suggestions,
}));

const TENANT_PLACES = { kind: 'profile' as const, places: ['Glebe, NSW 2037', 'Newtown, NSW'], suburb: 'Glebe' };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mocks.suggestions.mockReset().mockResolvedValue(suggestions([suggestion()], TENANT_PLACES));
  mocks.categories.mockReset().mockResolvedValue([
    { slug: 'cleaning-provider', category: 'cleaner', name: 'Cleaning Provider' },
  ] as Category[]);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

const show = () => render(<div className="bg-background"><TenantProviderSuggestions /></div>);
const selects = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'SELECT');

describe('TenantProviderSuggestions', () => {
  it('suggests providers for the tenant\'s own and preferred suburbs, with no property to pick', async () => {
    const view = await show();

    expect(mocks.suggestions.mock.calls).toEqual([[{ category: null, propertyId: null }]]);
    expect(textOf(getByName(view, 'h2', 'Service providers near you'))).toBe('Service providers near you');
    expect(textOf(view)).toContain('1 provider for Glebe, NSW 2037 and Newtown, NSW.');
    expect(selects(view)).toHaveLength(1);
    // A booking starts in the tenant's own suburb.
    expect(getByName(view, 'a', 'Request a booking: Bond clean with Sparkle Cleaning').getAttribute('href'))
      .toBe('/providers/sparkle-cleaning?service=s-1&suburb=Glebe#booking');
  });

  it('asks for one category when the tenant picks it', async () => {
    const view = await show();
    const [category] = selects(view);

    category.value = 'cleaning-provider';
    await dispatch(category, 'change');

    expect(mocks.suggestions.mock.calls.map(([query]) => query.category)).toEqual([null, 'cleaning-provider']);
  });

  it('goes back to every category when the one asked for is refused', async () => {
    mocks.suggestions.mockImplementation(async ({ category }) => {
      if (category) throw new ApiError(422, 'Choose a category from the list.');
      return suggestions([suggestion()], TENANT_PLACES);
    });
    const view = await show();
    const [category] = selects(view);
    category.value = 'cleaning-provider';
    await dispatch(category, 'change');

    await click(getByName(view, 'button', 'Show every category'));

    expect(category.value).toBe('');
    expect(textOf(view)).toContain('1 provider for Glebe, NSW 2037 and Newtown, NSW.');
  });

  it('points to the preferences when the tenant has no suburb to match on', async () => {
    mocks.suggestions.mockResolvedValue(suggestions([suggestion({ match: null })], { kind: 'none', places: [], suburb: null }));
    const view = await show();

    expect(textOf(view)).toContain('1 provider, ranked on their rating and price.');
    expect(getByName(view, 'a', 'your preferences').getAttribute('href')).toBe('/tenant/rental-preferences');
  });

  it('still lists every category when the catalogue cannot be read', async () => {
    mocks.categories.mockRejectedValue(new ApiError(503, 'Unavailable'));
    const view = await show();

    expect(descendants(selects(view)[0]).map(textOf)).toEqual(['All categories']);
    expect(textOf(view)).toContain('1 provider for');
  });

  it('keeps its text at AA contrast', async () => {
    expect(lowContrastText(await show())).toEqual([]);
  });
});
