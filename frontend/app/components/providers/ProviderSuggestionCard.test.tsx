import { cleanup, descendants, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestion } from '@/app/test-utils/provider-suggestions';
import ProviderSuggestionCard from './ProviderSuggestionCard';

vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

afterEach(cleanup);

const show = (props: Parameters<typeof ProviderSuggestionCard>[0]) =>
  render(<div className="bg-white"><ProviderSuggestionCard {...props} /></div>);
/** The reasons as read out: each item without its decorative bullet. */
const reasons = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'LI')
  .map((item) => textOf(item.childNodes.at(-1) as FakeElement));

describe('ProviderSuggestionCard', () => {
  it('shows the provider as the server sent it: name, seal, category, base, rating, price and reasons', async () => {
    const view = await show({ suggestion: suggestion() });

    const heading = getByName(view, 'h3', /Sparkle Cleaning/);
    expect(descendants(heading).find((element) => element.getAttribute('role') === 'img')?.getAttribute('aria-label')).toBe('Verified by TenantVoice');
    expect(textOf(view)).toContain('Cleaning Provider · Marrickville, NSW');
    expect(textOf(view)).toContain('Rated 4.8 out of 5 from 4 reviews');
    expect(textOf(view)).toContain('$120 · Bond clean');
    expect(reasons(view)).toEqual(suggestion().reasons);
    // The card is an article named by its heading.
    const article = descendants(view).find((element) => element.tagName === 'ARTICLE') as FakeElement;
    expect(article.getAttribute('aria-labelledby')).toBe(heading.getAttribute('id'));
  });

  it('opens the booking form for the suggested service, with the place\'s suburb, and the profile', async () => {
    const view = await show({ suggestion: suggestion(), suburb: 'Newtown' });

    // The visible words come first in each name, so a voice command saying them finds the link (WCAG 2.5.3).
    expect(getByName(view, 'a', 'Request a booking: Bond clean with Sparkle Cleaning').getAttribute('href'))
      .toBe('/providers/sparkle-cleaning?service=s-1&suburb=Newtown#booking');
    expect(getByName(view, 'a', 'View profile: Sparkle Cleaning').getAttribute('href')).toBe('/providers/sparkle-cleaning');
  });

  it('shows no seal for an unverified provider, "No ratings yet" without reviews and how a price is charged', async () => {
    const view = await show({ suggestion: suggestion({
      verified: false, rating_avg: null, review_count: 0, category_name: null, location: null, state: null,
      service: { id: 's-2', title: 'Clean by the hour', pricing_type: 'hourly', price: 85 },
    }) });

    expect(descendants(view).some((element) => element.getAttribute('role') === 'img')).toBe(false);
    expect(textOf(view)).toContain('No ratings yet');
    expect(textOf(view)).toContain('$85 per hour · Clean by the hour');
    expect(textOf(view)).toContain('Property services');
  });

  it('says a service has no price yet instead of showing $0', async () => {
    const view = await show({ suggestion: suggestion({ service: { id: 's-3', title: 'Quote visit', pricing_type: 'flat', price: 0 } }) });

    expect(textOf(view)).toContain('No price listed yet · Quote visit');
    expect(textOf(view)).not.toContain('$0');
  });

  it('shows only as many reasons as there is room for', async () => {
    const view = await show({ suggestion: suggestion(), reasonsShown: 2 });

    expect(reasons(view)).toEqual(['Serves Newtown', '4.8 from 4 reviews']);
  });

  it('keeps every text at AA contrast, also under the pointer', async () => {
    const view = await show({ suggestion: suggestion() });

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
