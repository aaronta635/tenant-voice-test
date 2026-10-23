import { cleanup, click, descendants, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { ProviderSuggestions } from '@/app/lib/provider-suggestions';
import { suggestion, suggestions } from '@/app/test-utils/provider-suggestions';
import ProviderSuggestionList from './ProviderSuggestionList';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/app/lib/provider-suggestions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/provider-suggestions')>()),
  getProviderSuggestions: mocks.get,
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mocks.get.mockReset().mockResolvedValue(suggestions([
    suggestion(),
    suggestion({ id: 'p-2', slug: 'local-cleaners', display_name: 'Local Cleaners', verified: false, reasons: ['Based in Newtown'] }),
  ]));
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

/** A promise the test settles when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const statusText = (view: FakeElement) => descendants(view).filter((element) => element.getAttribute('role') === 'status').map(textOf);
const titles = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'H3').map(textOf);
const show = (props: Parameters<typeof ProviderSuggestionList>[0] = {}) =>
  render(<div className="bg-white"><ProviderSuggestionList {...props} /></div>);

/** The list under a category switch, as a page's filter would change it. */
function Switching() {
  const [category, setCategory] = useState('cleaner');
  return (
    <div className="bg-white">
      <button type="button" onClick={() => setCategory('tradies')}>Tradies</button>
      <ProviderSuggestionList category={category} />
    </div>
  );
}

describe('ProviderSuggestionList', () => {
  it('says it is finding providers, then how many it found for where, in the server\'s order', async () => {
    const answer = deferred<ProviderSuggestions>();
    mocks.get.mockReturnValue(answer.promise);
    const view = await show({ category: 'cleaner', propertyId: 'home-1', limit: 3 });

    expect(statusText(view)).toEqual(['Finding providers…']);
    expect(mocks.get).toHaveBeenCalledWith({ category: 'cleaner', propertyId: 'home-1', limit: 3 });
    const live = descendants(view).find((element) => element.getAttribute('role') === 'status');

    await act(async () => answer.resolve(suggestions([suggestion(), suggestion({ id: 'p-2', display_name: 'Local Cleaners' })], {
      kind: 'property', property_title: 'King St terrace', property_id: 'home-1',
    })));
    await settle();

    expect(statusText(view)).toEqual(['2 providers for King St terrace, Newtown, NSW 2042.']);
    // The same live region, so a screen reader hears the answer.
    expect(descendants(view).find((element) => element.getAttribute('role') === 'status')).toBe(live);
    expect(titles(view)).toEqual(['Sparkle Cleaning', 'Local Cleaners']);
    expect(getByName(view, 'ul', 'Suggested providers')).toBeTruthy();
  });

  it('starts each booking request with the place\'s suburb', async () => {
    const view = await show();

    expect(getByName(view, 'a', 'Request a booking: Bond clean with Sparkle Cleaning').getAttribute('href'))
      .toBe('/providers/sparkle-cleaning?service=s-1&suburb=Newtown#booking');
  });

  it('asks again when a filter changes, and shows only the answer to the latest one', async () => {
    const first = deferred<ProviderSuggestions>();
    const second = deferred<ProviderSuggestions>();
    mocks.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = await render(<Switching />);

    await click(getByName(view, 'button', 'Tradies'));
    expect(mocks.get.mock.calls.map(([query]) => query.category)).toEqual(['cleaner', 'tradies']);
    expect(statusText(view)).toEqual(['Finding providers…']);

    await act(async () => second.resolve(suggestions([suggestion({ id: 'p-3', display_name: 'Newtown Trades' })])));
    await act(async () => first.resolve(suggestions([suggestion({ id: 'p-4', display_name: 'Late Cleaning' })])));
    await settle();

    expect(titles(view)).toEqual(['Newtown Trades']);
  });

  it('shows an error that a retry asks again for', async () => {
    mocks.get.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await show();

    expect(titles(view)).toEqual(['Provider suggestions could not be loaded']);
    expect(textOf(descendants(view).find((element) => element.getAttribute('role') === 'alert') as FakeElement))
      .toBe('The service is temporarily unavailable. Please try again.');
    expect(statusText(view)).toEqual(['']);

    await click(getByName(view, 'button', 'Try again'));

    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(statusText(view)).toEqual(['2 providers for your property in Newtown, NSW 2042.']);
  });

  it('offers all the owner\'s properties when the one asked for is not theirs', async () => {
    mocks.get.mockRejectedValue(new ApiError(404, 'Property not found'));
    const onPropertyGone = vi.fn();
    const view = await show({ propertyId: 'someone-elses', onPropertyGone });

    expect(titles(view)).toEqual(['This property could not be found']);
    await click(getByName(view, 'button', 'Show all my properties'));

    expect(onPropertyGone).toHaveBeenCalledTimes(1);
    expect(descendants(view).some((element) => textOf(element) === 'Try again')).toBe(false);
  });

  it('offers every category when the one asked for is not in the catalogue', async () => {
    mocks.get.mockRejectedValue(new ApiError(422, 'Choose a category from the list.'));
    const onCategoryRefused = vi.fn();
    const view = await show({ category: 'plumbing', onCategoryRefused });

    expect(titles(view)).toEqual(['This category is not offered']);
    expect(textOf(view)).toContain('Choose a category from the list.');
    await click(getByName(view, 'button', 'Show every category'));

    expect(onCategoryRefused).toHaveBeenCalledTimes(1);
  });

  it('says when no provider works in the places yet, with the way to that category\'s providers', async () => {
    mocks.get.mockResolvedValue(suggestions([], {}, { code: 'cleaner', slug: 'cleaning-provider', name: 'Cleaning Provider' }));
    const view = await show({ category: 'cleaning-provider' });

    expect(titles(view)).toEqual(['No providers to suggest yet']);
    expect(textOf(view)).toContain('No providers listed under Cleaning Provider work in your property in Newtown, NSW 2042 yet.');
    expect(getByName(view, 'a', 'Browse all providers').getAttribute('href')).toBe('/categories/cleaning-provider');
    expect(statusText(view)).toEqual(['No providers to suggest yet.']);
  });

  it('says the providers are ranked without a place, with the hint, when there is none to match', async () => {
    mocks.get.mockResolvedValue(suggestions([suggestion({ match: null, reasons: ['4.8 from 4 reviews'] })], { kind: 'none', places: [], suburb: null }));
    const view = await show({ noPlaceHint: <p>Add a property to see the providers who work there first.</p> });

    expect(statusText(view)).toEqual(['1 provider, ranked on their rating and price.']);
    expect(textOf(view)).toContain('Add a property to see the providers who work there first.');
    expect(getByName(view, 'a', 'Request a booking: Bond clean with Sparkle Cleaning').getAttribute('href'))
      .toBe('/providers/sparkle-cleaning?service=s-1#booking');
  });

  it('keeps the error and empty states at AA contrast', async () => {
    mocks.get.mockRejectedValueOnce(new ApiError(503, 'Unavailable.')).mockResolvedValueOnce(suggestions([]));
    const failed = await show();
    expect(lowContrastText(failed)).toEqual([]);

    const empty = await show();
    expect(lowContrastText(empty)).toEqual([]);
  });
});
