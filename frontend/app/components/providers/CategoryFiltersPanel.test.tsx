import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Category, PublicProvider } from '@/app/lib/api';
import { componentNamed, find, findAll, mount, textOf, type TestElement } from '@/app/test-utils/shallow-render';
import CategoryFiltersPanel from './CategoryFiltersPanel';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  ...(await import('@/app/test-utils/shallow-render')).fakeHooks,
}));

// replaceState changes the address bar at once, but Next only hands the new
// query to useSearchParams when its router transition commits. `committed` is
// what the hook returns; these tests never commit, like a render mid-typing.
const url = vi.hoisted(() => ({ pathname: '', search: '', committed: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => url.pathname,
  useSearchParams: () => new URLSearchParams(url.committed),
}));

const replaceState = vi.fn((_state: unknown, _unused: string, next: string) => {
  url.search = new URL(next, 'https://tenantvoice.invalid').search;
});

const tradies: Category = { slug: 'tradies', category: 'tradies', name: 'Tradies', description: 'Licensed trades.', icon_bg: null, badge: null, sort_order: 1, provider_count: 2, from_price: 120 };
const allCategories: Category = { ...tradies, slug: 'all', category: 'all', name: 'all categories' };
const coHost: Category = { ...tradies, slug: 'co-host-inspector', category: 'co_host_inspector', name: 'Co-Host Inspector' };

function provider(id: string, location: string, price: number) {
  return {
    id, slug: id, business_name: `Provider ${id}`, tagline: null, headline: null, specialties: [], verifications: [],
    availability_note: null, rating_avg: 4, review_count: 2, from_price: price, price_unit: 'fixed',
    profiles: { full_name: id, avatar_url: null, location, state: 'NSW', postcode: null, phone: null },
  } as unknown as PublicProvider;
}

function panel(category: Category, query = '') {
  url.pathname = category.slug === 'all' ? '/categories' : `/categories/${category.slug}`;
  url.search = url.committed = query;
  return mount(CategoryFiltersPanel, {
    category, providers: [provider('p1', 'Newtown', 120), provider('p2', 'Parramatta', 200)],
    serviceTypes: [], verificationOptions: [], availabilityOptions: [], priceCeiling: 300,
  });
}

const field = (tree: ReactNode, suffix: string) => find(tree, (element: TestElement) => element.type === 'input' && String(element.props.id).endsWith(suffix));
const type = (tree: ReactNode, suffix: string, value: string) => (field(tree, suffix).props.onChange as (event: unknown) => void)({ target: { value } });
const button = (tree: ReactNode, label: string) => find(tree, (element: TestElement) => element.type === 'button' && textOf(element) === label);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { location: url, history: { replaceState } });
  replaceState.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CategoryFiltersPanel text and range filters', () => {
  it('shows and applies typed text before the router commits the URL', () => {
    const view = panel(tradies, '?location=Paramatta');
    type(view.render(), '-location', 'Parramatta');
    const tree = view.render();
    expect(field(tree, '-location').props.value).toBe('Parramatta');
    expect(textOf(find(tree, (element) => element.props.role === 'status'))).toBe('1 of 2 providers matching Parramatta');
  });

  it('writes the URL once typing and dragging pause, not on every event', () => {
    const view = panel(tradies);
    for (const value of ['P', 'Pa', 'Par']) type(view.render(), '-search', value);
    for (let max = 290; max >= 150; max -= 10) type(view.render(), '-max', String(max));
    expect(field(view.render(), '-max').props.value).toBe(150);
    expect(replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/categories/tradies?search=Par&max=150');
  });

  // Safari 16.4-16.6 and Chrome/Edge 111-112, inside Next 16's default browser targets, have no URLSearchParams.size.
  it('keeps the filters in the URL on browsers whose URLSearchParams has no size', () => {
    const size = vi.spyOn(URLSearchParams.prototype, 'size', 'get').mockReturnValue(undefined as unknown as number);
    try {
      const view = panel(tradies);
      type(view.render(), '-search', 'Par');
      vi.advanceTimersByTime(300);
      expect(replaceState).toHaveBeenLastCalledWith(null, '', '/categories/tradies?search=Par');
    } finally {
      size.mockRestore();
    }
  });

  it('writes a pending change as soon as the field loses focus', () => {
    const view = panel(tradies);
    type(view.render(), '-location', 'Newtown');
    (field(view.render(), '-location').props.onBlur as () => void)();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/categories/tradies?location=Newtown');
  });

  it('clears typed filters without a late write bringing them back', () => {
    const view = panel(tradies, '?location=Newtown');
    type(view.render(), '-location', 'Newtow');
    (button(view.render(), 'Clear all').props.onClick as () => void)();
    vi.advanceTimersByTime(300);
    expect(field(view.render(), '-location').props.value).toBe('');
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/categories/tradies');
  });
});

describe('CategoryFiltersPanel on the all-categories listing', () => {
  it('keeps ?all=1 once location and keywords are cleared, so reloads and shared links still list providers', () => {
    const view = panel(allCategories, '?location=Sydney&category=&search=');
    type(view.render(), '-location', '');
    vi.advanceTimersByTime(300);
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/categories?category=&search=&all=1');
    (find(view.render(), (element) => element.type === 'select').props.onChange as (event: unknown) => void)({ target: { value: 'Highest rated' } });
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/categories?category=&search=&all=1&sort=Highest+rated');
  });

  it('does not add ?all=1 to a single category listing', () => {
    const view = panel(tradies, '?location=Sydney');
    type(view.render(), '-location', '');
    vi.advanceTimersByTime(300);
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/categories/tradies');
  });
});

describe('CategoryFiltersPanel co-host location suggestions', () => {
  const press = (tree: ReactNode, key: string) => {
    const preventDefault = vi.fn();
    (field(tree, '-area').props.onKeyDown as (event: unknown) => void)({ key, preventDefault });
    return preventDefault;
  };

  it('leaves the arrow keys to the caret while no suggestion matches', () => {
    const view = panel(coHost);
    type(view.render(), '-area', 'Zzyzx');
    expect(press(view.render(), 'ArrowDown')).not.toHaveBeenCalled();
    const area = field(view.render(), '-area');
    expect(area.props['aria-expanded']).toBe(false);
    expect(area.props['aria-activedescendant']).toBeUndefined();
  });

  it('points aria-activedescendant only at a suggestion the open list shows', () => {
    const view = panel(coHost);
    type(view.render(), '-area', 'Newt');
    expect(press(view.render(), 'ArrowDown')).toHaveBeenCalled();
    const tree = view.render();
    const highlighted = find(tree, (element) => element.props.role === 'option' && element.props['aria-selected'] === true);
    expect(textOf(highlighted)).toBe('Newtown');
    expect(field(tree, '-area').props['aria-activedescendant']).toBe(highlighted.props.id);

    type(view.render(), '-area', 'Newtownz');
    press(view.render(), 'ArrowDown');
    expect(field(view.render(), '-area').props['aria-activedescendant']).toBeUndefined();
  });

  it('never points aria-activedescendant at a suggestion the sidebar Location filter removed', () => {
    const view = panel(coHost);
    type(view.render(), '-area', 'Newt');
    press(view.render(), 'ArrowDown');
    expect(textOf(find(view.render(), (element) => element.props.role === 'option' && element.props['aria-selected'] === true))).toBe('Newtown');
    (field(view.render(), '-area').props.onBlur as () => void)();
    // The sidebar field shares the draft but leaves the highlighted index alone.
    type(view.render(), '-location', 'Zzyzx');
    (field(view.render(), '-area').props.onFocus as () => void)();

    const tree = view.render();
    // Absent, or the id of an element that is really there.
    const ids = findAll(tree, (element) => typeof element.props.id === 'string').map((element) => element.props.id);
    expect([undefined, ...ids]).toContain(field(tree, '-area').props['aria-activedescendant']);
  });

  it('never points aria-activedescendant past the suggestions the sidebar Location filter leaves', () => {
    const view = panel(coHost);
    type(view.render(), '-area', 'Newt');
    press(view.render(), 'ArrowDown');
    press(view.render(), 'ArrowDown');
    expect(textOf(find(view.render(), (element) => element.props.role === 'option' && element.props['aria-selected'] === true))).toBe('Newtown, NSW');
    (field(view.render(), '-area').props.onBlur as () => void)();
    // One suggestion is left, so the list stays open without the highlighted second one.
    type(view.render(), '-location', 'Newtown N');
    (field(view.render(), '-area').props.onFocus as () => void)();

    const tree = view.render();
    expect(findAll(tree, (element) => element.props.role === 'option').map(textOf)).toEqual(['Newtown, NSW']);
    const ids = findAll(tree, (element) => typeof element.props.id === 'string').map((element) => element.props.id);
    expect([undefined, ...ids]).toContain(field(tree, '-area').props['aria-activedescendant']);
  });
});

describe('CategoryFiltersPanel provider cards', () => {
  it('hand each profile the listing with its filters, for the way back', () => {
    const view = panel(tradies, '?location=Newtown&rating=4.0%2B');
    const cards = findAll(view.render(), componentNamed('ProviderCard'));
    expect(cards.map((card) => card.props.listingHref)).toEqual(['/categories/tradies?location=Newtown&rating=4.0%2B']);
  });
});
