import { describe, expect, it } from 'vitest';
import { renderMarkup } from '@/app/test-utils/static-markup';
import HowItWorksPage from './page';

describe('How it works copy', () => {
  it('describes provider pricing as upfront, since services can be hourly or "from" prices', () => {
    const { text } = renderMarkup(<HowItWorksPage />);
    expect(text).not.toMatch(/fixed.price/i);
    expect(text).toContain('service providers list upfront prices');
  });
});
