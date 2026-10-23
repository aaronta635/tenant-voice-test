import { cleanup, descendants, render } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, describe, expect, it } from 'vitest';
import { renderMarkup } from '@/app/test-utils/static-markup';
import RatingBadge, { ratingDescription } from './RatingBadge';
import VerifiedBadge, { VERIFIED_LABEL } from './VerifiedBadge';

afterEach(cleanup);

/** The text a sighted reader sees: the markup without its screen-reader-only spans. */
const visibleText = (html: string) => html.replace(/<span class="sr-only">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('RatingBadge', () => {
  it('shows the average to one decimal and the review count in a pill', () => {
    const { html, text } = renderMarkup(<RatingBadge average={4.75} count={25} />);

    expect(visibleText(html)).toBe('4.8 (25)');
    expect(text).toContain('Rated 4.8 out of 5 from 25 reviews');
    expect(html).toContain('bg-navy');
  });

  it('leaves the count out where there is no room, but still says it to screen readers', () => {
    const { html, text } = renderMarkup(<RatingBadge average={5} count={1} showCount={false} />);

    expect(visibleText(html)).toBe('5.0');
    expect(text).toContain('Rated 5.0 out of 5 from 1 review');
  });

  it.each([
    ['no reviews from the marketplace', 0, 0],
    ['no reviews from the public profiles', null, 0],
    ['a missing average', undefined, 3],
  ])('says "No ratings yet" for %s', (_case, average, count) => {
    const { text, html } = renderMarkup(<RatingBadge average={average} count={count} />);

    expect(text).toBe('No ratings yet');
    expect(html).not.toContain('bg-navy');
  });

  it('describes a rating the way the badge shows it', () => {
    expect(ratingDescription(4.25, 1200)).toBe('Rated 4.3 out of 5 from 1,200 reviews');
  });

  it('keeps both badges at AA contrast on a card', async () => {
    const view = await render(
      <div className="bg-white">
        <RatingBadge average={4.5} count={12} />
        <RatingBadge average={null} count={0} />
      </div>,
    );

    expect(lowContrastText(view)).toEqual([]);
  });
});

describe('VerifiedBadge', () => {
  it('is a seal image with an accessible name and a tooltip', async () => {
    const view = await render(<VerifiedBadge />);
    const [seal] = descendants(view).filter((element) => element.getAttribute('role') === 'img');

    expect(seal.getAttribute('aria-label')).toBe(VERIFIED_LABEL);
    expect(seal.getAttribute('title')).toBe(VERIFIED_LABEL);
    // Its name comes from the label alone, so a heading beside it keeps its own text.
    expect(seal.textContent).toBe('');
    expect(descendants(seal).find((element) => element.tagName === 'svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes another name where the context needs one', () => {
    expect(renderMarkup(<VerifiedBadge label="Verified provider" />).html).toContain('aria-label="Verified provider"');
  });
});
