import { describe, expect, it } from 'vitest';
import { listingHref } from './listing-href';

describe('listingHref', () => {
  it.each(['/categories/tradies?location=Newtown&rating=4.0%2B', '/categories?location=Sydney&all=1', '/categories'])('keeps the listing %s', (from) => {
    expect(listingHref(from)).toBe(from);
  });

  it.each([undefined, '', 'https://evil.example/categories', '//evil.example/categories', '/%2F%2Fevil.example', '/categoriesx', '/providers/amelia', '/dashboard'])('ignores %s', (from) => {
    expect(listingHref(from)).toBeNull();
  });

  it('ignores a repeated ?from=', () => {
    expect(listingHref(['/categories/tradies', '/categories'])).toBeNull();
  });
});
