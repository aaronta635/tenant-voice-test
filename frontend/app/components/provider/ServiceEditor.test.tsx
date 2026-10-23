import { cleanup, click, descendants, dispatch, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderService } from '@/app/lib/api';
import ServiceEditor from './ServiceEditor';

const mockApi = vi.hoisted(() => ({ providers: { createService: vi.fn(), updateService: vi.fn() } }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));

const windowClean: ProviderService = {
  id: 'windows', provider_id: 'prov-1', title: 'Window clean', description: 'Inside and out, up to two storeys.',
  pricing_type: 'hourly', price: 85, duration_minutes: 60, inclusions: null, exclusions: null, service_area: null,
  category: 'GENERAL', cancellation_policy: null, is_active: true, sort_order: 1, booking_count: 0,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

const byPlaceholder = (view: FakeElement, placeholder: string) =>
  descendants(view).find((element) => element.getAttribute('placeholder') === placeholder) as FakeElement;
const priceInput = (view: FakeElement) => byPlaceholder(view, '99');
const preview = (view: FakeElement) => textOf(descendants(view).find((element) => element.id === 'service-price-preview') as FakeElement);
const priceLabel = (view: FakeElement) => textOf(priceInput(view).parentNode as unknown as FakeElement);
const submit = (view: FakeElement) => dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ServiceEditor pricing', () => {
  it('shows a new price on the terms every card and page shows it', async () => {
    const view = await render(<ServiceEditor onClose={() => undefined} onSaved={() => undefined} />);
    expect(preview(view)).toBe('Clients see the price once you enter one.');
    expect(priceLabel(view)).toBe('Price (AUD)');

    await typeInto(priceInput(view), '1,200');
    expect(preview(view)).toBe('Clients see: $1,200');
  });

  it.each([
    ['hourly', 'Rate per hour (AUD)', 'Clients see: $85 per hour'],
    ['from', 'Starting price (AUD)', 'Clients see: from $85'],
    ['flat', 'Price (AUD)', 'Clients see: $85'],
  ] as const)('labels and previews a %s price', async (pricingType, label, shown) => {
    const view = await render(<ServiceEditor service={{ ...windowClean, pricing_type: pricingType }} onClose={() => undefined} onSaved={() => undefined} />);

    expect(priceLabel(view)).toBe(label);
    expect(preview(view)).toBe(shown);
  });

  it('reads the preview with the price field', async () => {
    const view = await render(<ServiceEditor onClose={() => undefined} onSaved={() => undefined} />);

    expect(priceInput(view).getAttribute('aria-describedby')).toBe('service-price-preview');
  });

  it('keeps the pricing type it previewed when the service saves', async () => {
    mockApi.providers.updateService.mockResolvedValue({ ...windowClean, price: 90 });
    const onSaved = vi.fn();
    const view = await render(<ServiceEditor service={windowClean} onClose={() => undefined} onSaved={onSaved} />);

    await typeInto(priceInput(view), '$90');
    expect(preview(view)).toBe('Clients see: $90 per hour');
    await submit(view);

    expect(mockApi.providers.updateService).toHaveBeenCalledWith('windows', expect.objectContaining({ pricing_type: 'hourly', price: 90 }));
    expect(onSaved).toHaveBeenCalledWith({ ...windowClean, price: 90 });
  });
});

describe('ServiceEditor and the shared service rules', () => {
  const descriptionField = (view: FakeElement) =>
    byPlaceholder(view, 'What the client gets and how the job runs.');

  it('asks for a description before it sends an enabled service', async () => {
    const view = await render(<ServiceEditor onClose={() => undefined} onSaved={() => undefined} />);

    await typeInto(byPlaceholder(view, 'e.g. Rental appraisal'), 'Leak check');
    await typeInto(priceInput(view), '120');
    await submit(view);

    expect(mockApi.providers.createService).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Add a description to enable this service.');
    expect(descriptionField(view).getAttribute('aria-invalid')).toBe('true');
  });

  it('sends the category the provider picked, one of the shared codes', async () => {
    mockApi.providers.createService.mockResolvedValue(windowClean);
    const view = await render(<ServiceEditor onClose={() => undefined} onSaved={() => undefined} />);
    const category = descendants(view).find((element) => element.tagName === 'SELECT') as FakeElement;

    expect(descendants(category).map((option) => option.getAttribute('value'))).toEqual([
      'PLUMBING', 'ELECTRICAL', 'HVAC', 'APPLIANCE', 'LOCKS_SECURITY', 'LEAK', 'SAFETY', 'GENERAL',
    ]);
    await typeInto(byPlaceholder(view, 'e.g. Rental appraisal'), 'Leak check');
    await typeInto(descriptionField(view), 'We find the leak and quote the fix.');
    await typeInto(priceInput(view), '120');
    category.value = 'LEAK';
    await dispatch(category, 'change');
    await submit(view);

    expect(mockApi.providers.createService).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Leak check', description: 'We find the leak and quote the fix.', price: 120, category: 'LEAK', is_active: true,
    }));
  });

  it('lets a draft go without a description or a price', async () => {
    mockApi.providers.createService.mockResolvedValue({ ...windowClean, is_active: false });
    const view = await render(<ServiceEditor onClose={() => undefined} onSaved={() => undefined} />);
    const label = descendants(view).find((element) => element.tagName === 'LABEL' && textOf(element) === 'Show this service on my public profile') as FakeElement;
    const publish = descendants(label).find((element) => element.tagName === 'INPUT') as FakeElement;

    await typeInto(byPlaceholder(view, 'e.g. Rental appraisal'), 'Leak check');
    await typeInto(priceInput(view), '0');
    publish.checked = false;
    await click(publish);
    await submit(view);

    expect(mockApi.providers.createService).toHaveBeenCalledWith(expect.objectContaining({ price: 0, is_active: false, description: null }));
  });
});
