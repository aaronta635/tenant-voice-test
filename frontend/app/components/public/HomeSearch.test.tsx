import { cleanup, descendants, dispatch, getByName, render, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchHref, type SearchType } from '@/app/lib/home-search';
import { parseProfileSearch, profileSearchHref, searchTypeHref } from '@/app/lib/public-profiles';
import { createFakeHistory } from '@/app/test-utils/fake-history';
import { renderMarkup } from '@/app/test-utils/static-markup';
import HomeSearch from './HomeSearch';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

let leavePage = () => {};
beforeEach(() => {
  vi.clearAllMocks();
  leavePage = createFakeHistory('/').install(window);
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

const byTag = (view: FakeElement, tag: string) => descendants(view).find((element) => element.tagName === tag) as FakeElement;

async function search(type: string, text: string) {
  const view = await render(<HomeSearch />);
  const select = byTag(view, 'SELECT');
  select.value = type;
  await dispatch(select, 'change');
  await typeInto(byTag(view, 'INPUT'), text);
  await dispatch(byTag(view, 'FORM'), 'submit');
  return router.push.mock.calls.at(-1)?.[0];
}

describe('HomeSearch', () => {
  it('searches every kind of profile on the search page by default', async () => {
    const view = await render(<HomeSearch />);
    await typeInto(byTag(view, 'INPUT'), 'Jane');
    await dispatch(byTag(view, 'FORM'), 'submit');
    expect(router.push).toHaveBeenCalledWith('/search?type=profiles&role=all&q=Jane');
  });

  it.each([
    ['profiles', 'Newtown', '/search?type=profiles&role=all&q=Newtown'],
    ['services', 'bond clean', '/categories?search=bond+clean'],
    ['properties', 'Newtown', '/properties?q=Newtown'],
  ])('opens %s results for the text on their own page', async (type, text, href) => {
    expect(await search(type, text)).toBe(href);
  });

  it.each([
    ['profiles', '/search?type=profiles&role=all'],
    ['services', '/categories'],
    ['properties', '/properties'],
  ])('opens every %s when the box is left blank', async (type, href) => {
    expect(await search(type, '   ')).toBe(href);
  });

  it('searches before the page hydrates too: the native GET asks /search, which opens what the homepage would', () => {
    // The markup the browser has until the script loads.
    const { html } = renderMarkup(<HomeSearch />);
    const attribute = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
    const form = /<form\b[^>]*>/.exec(html)?.[0] ?? '';
    expect([attribute(form, 'action'), attribute(form, 'method')]).toEqual(['/search', undefined]);
    const fields = [...html.matchAll(/<(?:select|input)\b[^>]*>/g)].map(([tag]) => [attribute(tag, 'name'), attribute(tag, 'type'), attribute(tag, 'value')]);
    expect(fields).toEqual([['type', undefined, undefined], ['q', 'search', ''], ['role', 'hidden', 'all']]);
    const types = [...html.matchAll(/<option value="(\w+)"/g)].map(([, value]) => value as SearchType);
    expect(types).toEqual(['profiles', 'services', 'properties']);
    expect(html).toMatch(/<option value="profiles" selected="">/);

    for (const type of types) {
      for (const text of ['', 'Newtown']) {
        // The query the browser builds from those fields; /search redirects it or shows profiles.
        const query = new URLSearchParams({ type, q: text, role: 'all' });
        expect(searchTypeHref(query) ?? profileSearchHref(parseProfileSearch(query))).toBe(searchHref(type, text));
      }
    }
  });

  it('tells the visitor what each type searches', async () => {
    const view = await render(<HomeSearch />);
    const input = byTag(view, 'INPUT');
    expect(input.getAttribute('placeholder')).toBe('Tenants, landlords or providers');
    const select = byTag(view, 'SELECT');
    select.value = 'properties';
    await dispatch(select, 'change');
    expect(input.getAttribute('placeholder')).toBe('Suburb, street or property name');
  });

  it('labels both fields and keeps its text at AA contrast, also under the pointer', async () => {
    const view = await render(<HomeSearch />);
    for (const element of [byTag(view, 'SELECT'), byTag(view, 'INPUT')]) {
      expect(descendants(view).some((label) => label.tagName === 'LABEL' && label.getAttribute('for') === element.id)).toBe(true);
    }
    expect(getByName(view, 'button', 'Search').getAttribute('type')).toBe('submit');
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
