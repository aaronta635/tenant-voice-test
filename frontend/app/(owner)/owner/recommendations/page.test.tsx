import { cleanup, click, descendants, dispatch, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Category, type Property } from '@/app/lib/api';
import { suggestion, suggestions } from '@/app/test-utils/provider-suggestions';
import OwnerRecommendationsPage from './page';

/** The query useSearchParams reports; setSearchParams writes it, as the History API does under Next. */
const navigation = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    search: '',
    listeners,
    sync(search: string) { this.search = search; listeners.forEach((listener) => listener()); },
  };
});
const mocks = vi.hoisted(() => ({ suggestions: vi.fn(), listMine: vi.fn(), categories: vi.fn() }));

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => { navigation.listeners.add(listener); return () => { navigation.listeners.delete(listener); }; };
  return {
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => navigation.search)),
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  };
});
vi.mock('@/app/lib/page-url', () => ({
  setSearchParams: vi.fn((changes: Record<string, string | null>) => {
    const params = new URLSearchParams(navigation.search);
    for (const [key, value] of Object.entries(changes)) if (value) params.set(key, value); else params.delete(key);
    navigation.sync(params.toString());
  }),
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { properties: { listMine: mocks.listMine }, categories: { list: mocks.categories } },
}));
vi.mock('@/app/lib/provider-suggestions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/provider-suggestions')>()),
  getProviderSuggestions: mocks.suggestions,
}));
// The people suggestions are the network area's; these tests cover the providers above them.
vi.mock('@/app/components/tenant/NetworkRecommendations', () => ({ default: () => <section><h2>People You Might Know</h2></section> }));

const HOMES = [
  { id: 'home-1', title: 'King St terrace', suburb: 'Newtown' },
  { id: 'home-2', title: 'Oxford St flat', suburb: 'Paddington' },
] as Property[];
const CATEGORIES = [
  { slug: 'cleaning-provider', category: 'cleaner', name: 'Cleaning Provider' },
  { slug: 'tradies', category: 'tradie', name: 'Tradies' },
] as Category[];

beforeEach(() => {
  navigation.search = '';
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mocks.suggestions.mockReset().mockResolvedValue(suggestions([suggestion()], {
    places: ['Newtown, NSW 2042', 'Paddington, NSW 2021'], suburb: null,
  }));
  mocks.listMine.mockReset().mockResolvedValue(HOMES);
  mocks.categories.mockReset().mockResolvedValue(CATEGORIES);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

const select = (view: FakeElement, label: string) => {
  const field = descendants(view).find((element) => element.tagName === 'LABEL' && textOf(element) === label) as FakeElement;
  return descendants(view).find((element) => element.id === field.getAttribute('for')) as FakeElement;
};
const optionsOf = (element: FakeElement) => descendants(element).filter((option) => option.tagName === 'OPTION').map(textOf);
const option = (element: FakeElement, text: string) =>
  descendants(element).find((item) => item.tagName === 'OPTION' && textOf(item) === text) as FakeElement & { selected: boolean };
async function choose(element: FakeElement, value: string) {
  element.value = value;
  await dispatch(element, 'change');
}
const queries = () => mocks.suggestions.mock.calls.map(([query]) => query);

describe('the owner recommendations', () => {
  it('suggests providers for all the owner\'s properties first, then the people', async () => {
    const view = await render(<OwnerRecommendationsPage />);

    expect(queries()).toEqual([{ category: null, propertyId: null }]);
    const headings = descendants(view).filter((element) => element.tagName === 'H2').map(textOf);
    expect(headings).toEqual(['Suggested providers', 'People You Might Know']);
    expect(textOf(view)).toContain('1 provider for your properties in Newtown, NSW 2042 and Paddington, NSW 2021.');
    expect(textOf(view)).toContain('how its price compares with the median for the same kind of price');
    expect(getByName(view, 'a', 'View profile: Sparkle Cleaning').getAttribute('href')).toBe('/providers/sparkle-cleaning');
  });

  it('offers each of the owner\'s properties and every category to pick from', async () => {
    const view = await render(<OwnerRecommendationsPage />);

    expect(optionsOf(select(view, 'Property'))).toEqual(['All my properties', 'King St terrace · Newtown', 'Oxford St flat · Paddington']);
    expect(optionsOf(select(view, 'Category'))).toEqual(['All categories', 'Cleaning Provider', 'Tradies']);
  });

  it('keeps the picks in the URL and asks for the providers they name', async () => {
    const view = await render(<OwnerRecommendationsPage />);

    await choose(select(view, 'Property'), 'home-1');
    expect(navigation.search).toBe('property=home-1');
    await choose(select(view, 'Category'), 'tradies');
    expect(navigation.search).toBe('property=home-1&category=tradies');
    await choose(select(view, 'Property'), '');

    expect(navigation.search).toBe('category=tradies');
    expect(queries()).toEqual([
      { category: null, propertyId: null },
      { category: null, propertyId: 'home-1' },
      { category: 'tradies', propertyId: 'home-1' },
      { category: 'tradies', propertyId: null },
    ]);
  });

  it('opens on the picks a link holds', async () => {
    navigation.search = 'property=home-2&category=cleaning-provider';
    const view = await render(<OwnerRecommendationsPage />);

    expect(queries()).toEqual([{ category: 'cleaning-provider', propertyId: 'home-2' }]);
    // The options React marks chosen once they load (the test DOM leaves the first one marked too).
    expect(option(select(view, 'Property'), 'Oxford St flat · Paddington').selected).toBe(true);
    expect(option(select(view, 'Category'), 'Cleaning Provider').selected).toBe(true);
  });

  it('goes back to all the owner\'s properties from one that is not theirs', async () => {
    navigation.search = 'property=someone-elses';
    mocks.suggestions.mockImplementation(async ({ propertyId }) => {
      if (propertyId) throw new ApiError(404, 'Property not found');
      return suggestions();
    });
    const view = await render(<OwnerRecommendationsPage />);

    expect(textOf(view)).toContain('This property could not be found');
    await click(getByName(view, 'button', 'Show all my properties'));

    expect(navigation.search).toBe('');
    expect(textOf(view)).toContain('1 provider for your property in Newtown, NSW 2042.');
  });

  it('still suggests for every property when the owner\'s properties cannot be listed', async () => {
    mocks.listMine.mockRejectedValue(new ApiError(503, 'Unavailable'));
    const view = await render(<OwnerRecommendationsPage />);

    expect(optionsOf(select(view, 'Property'))).toEqual(['All my properties']);
    expect(textOf(view)).toContain('Your properties could not be loaded, so all of them are used.');
    expect(textOf(view)).toContain('1 provider for');
  });

  it('labels the people suggestions as the demo, not the providers', async () => {
    const view = await render(<OwnerRecommendationsPage />);

    const label = descendants(view).find((element) => element.hasAttribute('data-demo-label')) as FakeElement;
    expect(textOf(label)).toMatch(/^Demo: The people suggestions below are public profiles/);
    const order = descendants(view).map((element) => element.tagName === 'H2' ? textOf(element) : element === label ? 'label' : null).filter(Boolean);
    expect(order).toEqual(['Suggested providers', 'label', 'People You Might Know']);
  });

  it('keeps the providers section at AA contrast', async () => {
    const view = await render(<div className="bg-background"><OwnerRecommendationsPage /></div>);
    await act(async () => {});

    expect(lowContrastText(view)).toEqual([]);
  });
});
