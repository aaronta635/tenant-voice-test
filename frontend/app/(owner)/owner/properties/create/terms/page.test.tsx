import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Property } from '@/app/lib/api';
import CreateListingRentalTermsPage from './page';

const mockApi = vi.hoisted(() => ({ properties: { create: vi.fn() } }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const DRAFT_KEY = 'tv_listing_draft';
const DRAFT = {
  title: 'Harbour flat', address: '1 Harbour Street', suburb: 'Wollongong', state: 'NSW', postcode: '2500',
  price: '650',
};
const GATE = 'Your account needs to be verified before you can publish listings. Upload the documents it asks for, or wait for the review to finish.';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const refused = () => new ApiError(403, GATE, {
  code: 'verification_required', action: 'publish_listing', status: 'pending', message: GATE,
  documents_href: '/owner/profile/verification',
});

async function publish(view: FakeElement) {
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(DRAFT));
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the last step of a new listing', () => {
  it('publishes the listing and opens its page', async () => {
    mockApi.properties.create.mockResolvedValue({ id: 'pr-1' } as Property);
    const view = await render(<CreateListingRentalTermsPage />);

    await publish(view);

    expect(mockApi.properties.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Harbour flat', price: 650 }));
    expect(mockApi.properties.create.mock.calls[0][0].status).toBe('available');
    expect(router.push).toHaveBeenCalledWith('/owner/properties/pr-1');
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('says why an unverified owner cannot publish, and saves the listing off the market instead', async () => {
    mockApi.properties.create.mockRejectedValueOnce(refused()).mockResolvedValueOnce({ id: 'pr-2' } as Property);
    const view = await render(<CreateListingRentalTermsPage />);

    await publish(view);

    const [alert] = descendants(view).filter((element) => element.getAttribute('role') === 'alert');
    expect(textOf(alert)).toBe(`Verification needed${GATE}Go to your documents`);
    expect(getByName(view, 'a', 'Go to your documents').getAttribute('href')).toBe('/owner/profile/verification');
    expect(router.push).not.toHaveBeenCalled();
    // The draft is kept until the listing is saved.
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}').title).toBe('Harbour flat');
    expect(lowContrastText(view)).toEqual([]);

    await click(getByName(view, 'button', 'Save it unpublished'));
    await settle();

    expect(mockApi.properties.create).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Harbour flat', status: 'off_market',
    }));
    expect(router.push).toHaveBeenCalledWith('/owner/properties/pr-2');
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('shows any other refusal as it did', async () => {
    mockApi.properties.create.mockRejectedValue(new ApiError(422, 'Weekly rent is required.'));
    const view = await render(<CreateListingRentalTermsPage />);

    await publish(view);

    expect(textOf(view)).toContain('Weekly rent is required.');
    expect(textOf(view)).not.toContain('Verification needed');
    expect(descendants(view).some((element) => textOf(element) === 'Save it unpublished')).toBe(false);
  });
});
