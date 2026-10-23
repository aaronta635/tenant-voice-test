import { describe, expect, it } from 'vitest';
import { formatServicePrice } from './format';
import { clientPricePreview, PRICING_OPTIONS, pricingOption } from './provider-pricing';

describe('provider pricing', () => {
  it('offers the three pricing types the backend writes', () => {
    expect(PRICING_OPTIONS.map((option) => [option.value, option.label])).toEqual([
      ['flat', 'Fixed price'], ['hourly', 'Hourly rate'], ['from', 'Starting from'],
    ]);
  });

  it('labels the price field by its type, and reads a missing type as a fixed price', () => {
    expect(pricingOption('hourly').amountLabel).toBe('Rate per hour (AUD)');
    expect(pricingOption('from').amountLabel).toBe('Starting price (AUD)');
    expect(pricingOption(null).value).toBe('flat');
  });

  it.each([
    ['flat', '$150', '$150'],
    ['hourly', '85', '$85 per hour'],
    ['from', '1,200', 'from $1,200'],
  ] as const)('previews a %s price exactly as cards and pages show it', (type, typed, shown) => {
    expect(clientPricePreview(typed, type)).toBe(shown);
    expect(clientPricePreview(typed, type)).toBe(formatServicePrice(Number(typed.replace(/[$,]/g, '')), type));
  });

  it('previews nothing until the text is a price', () => {
    expect(clientPricePreview('', 'flat')).toBeNull();
    expect(clientPricePreview('abc', 'hourly')).toBeNull();
    expect(clientPricePreview('0', 'from')).toBeNull();
  });
});
