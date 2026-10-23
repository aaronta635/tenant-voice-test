// How a service is priced (tracker assumption #10): a fixed price, an hourly
// rate or a "from" price, the three pricing_type values the backend writes
// and reads every mobile spelling as (services/maps_provider_core.py). The
// service form and the onboarding rows offer them in these words, and every
// card and page shows the price through formatServicePrice.

import type { ProviderService } from './api';
import { formatServicePrice } from './format';
import { parseServiceAmount } from './provider-workspace';

export type PricingType = ProviderService['pricing_type'];

export type PricingOption = {
  value: PricingType;
  label: string;
  hint: string;
  /** The price field's label while this type is chosen. */
  amountLabel: string;
};

export const PRICING_OPTIONS: PricingOption[] = [
  { value: 'flat', label: 'Fixed price', hint: 'One price for the whole job', amountLabel: 'Price (AUD)' },
  { value: 'hourly', label: 'Hourly rate', hint: 'Charged per hour on site', amountLabel: 'Rate per hour (AUD)' },
  { value: 'from', label: 'Starting from', hint: 'Final price depends on the property', amountLabel: 'Starting price (AUD)' },
];

/** The option for a pricing type; a fixed price for none, as the backend reads an empty one. */
export function pricingOption(type: string | null | undefined): PricingOption {
  return PRICING_OPTIONS.find((option) => option.value === type) ?? PRICING_OPTIONS[0];
}

/** The price as clients will see it on cards and pages, for what is typed; null until it is a price. */
export function clientPricePreview(price: string, type: PricingType): string | null {
  const amount = parseServiceAmount(price);
  return Number.isFinite(amount) && amount > 0 ? formatServicePrice(amount, type) : null;
}
