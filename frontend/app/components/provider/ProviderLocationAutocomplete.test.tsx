import { cleanup, descendants, fire, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProviderLocationAutocomplete from './ProviderLocationAutocomplete';

const mockApi = vi.hoisted(() => ({ recommendations: { providerLocations: vi.fn() } }));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));

afterEach(cleanup);

async function press(element: FakeElement, key: string) {
  await act(async () => { fire(element, 'keydown', { key }); });
}

/** Suggestions are looked up 250ms after the list opens. */
async function waitForLookup() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  await settle();
}

describe('ProviderLocationAutocomplete suggestions', () => {
  it('shows the highlighted suggestion at AA contrast', async () => {
    mockApi.recommendations.providerLocations.mockResolvedValue({
      items: [{ label: 'Newtown, NSW', value: 'Newtown, NSW' }, { label: 'Parramatta, NSW', value: 'Parramatta, NSW' }],
    });
    const view = await render(<ProviderLocationAutocomplete id="area" value="" onChange={() => undefined} onSelect={() => undefined} />);
    const field = descendants(view).find((element) => element.id === 'area') as FakeElement;
    await press(field, 'ArrowDown');
    await waitForLookup();
    await press(field, 'ArrowDown');

    const highlighted = descendants(view).filter((element) => element.getAttribute('aria-selected') === 'true');
    expect(highlighted.map(textOf)).toEqual(['Newtown, NSW']);
    expect(field.getAttribute('aria-activedescendant')).toBe(highlighted[0].id);
    expect(lowContrastText(view)).toEqual([]);
  });
});
