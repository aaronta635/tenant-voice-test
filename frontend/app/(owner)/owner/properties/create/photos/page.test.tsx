import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type UploadResult } from '@/app/lib/api';
import CreateListingPhotosDescriptionPage from './page';

const mockApi = vi.hoisted(() => ({
  properties: { amenities: vi.fn() },
  uploads: { propertyImage: vi.fn(), discardPropertyImage: vi.fn() },
}));
const navigation = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.navigate(href)),
}));

const DRAFT_KEY = 'tv_listing_draft';
const BUCKET = 'https://example.supabase.co/storage/v1/object/public/property-images/owner';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function draft() {
  return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as {
    photo_urls?: string[]; description?: string; amenities?: string[];
  };
}

function uploaded(name: string): UploadResult {
  return { url: `${BUCKET}/${name}`, path: `owner/${name}`, content_type: 'image/jpeg', size: 10 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function choose(view: FakeElement, ...files: File[]) {
  const input = getByName(view, 'input', 'Add listing photos');
  input.files = files;
  await dispatch(input, 'change');
}

const photo = (name: string, bytes = 10, type = 'image/jpeg') => new File([new Uint8Array(bytes)], name, { type });
const shown = (view: FakeElement) =>
  descendants(view).filter((element) => element.tagName === 'IMG').map((image) => image.getAttribute('src'));
const alertText = (view: FakeElement) =>
  textOf(descendants(view).find((element) => element.getAttribute('role') === 'alert') as FakeElement);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('sessionStorage', memoryStorage());
  mockApi.properties.amenities.mockResolvedValue([]);
  mockApi.uploads.discardPropertyImage.mockResolvedValue(undefined);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the description', () => {
  it('is a field labelled Description, not only by its placeholder', async () => {
    const view = await render(<CreateListingPhotosDescriptionPage />);

    const label = descendants(view).find((element) => element.tagName === 'LABEL' && textOf(element) === 'Description')!;
    const field = descendants(view).find((element) => element.id && element.id === label.getAttribute('for'));
    expect(field?.tagName).toBe('TEXTAREA');
    expect(field?.getAttribute('placeholder')).toBe('Describe the property...');
  });
});

describe('listing photos', () => {
  it('uploads each chosen photo and keeps only its link in the draft', async () => {
    mockApi.uploads.propertyImage.mockImplementation(async (file: File) => uploaded(file.name));
    const view = await render(<CreateListingPhotosDescriptionPage />);

    await choose(view, photo('front.jpg'), photo('kitchen.jpg'));

    expect(mockApi.uploads.propertyImage).toHaveBeenCalledTimes(2);
    expect(shown(view)).toEqual([`${BUCKET}/front.jpg`, `${BUCKET}/kitchen.jpg`]);
    expect(draft().photo_urls).toEqual([`${BUCKET}/front.jpg`, `${BUCKET}/kitchen.jpg`]);
  });

  it('says why a photo was refused and keeps the others', async () => {
    mockApi.uploads.propertyImage.mockImplementation(async (file: File) => {
      if (file.name === 'broken.jpg') throw new ApiError(415, 'Unsupported file type. Allowed: image/jpeg, image/png');
      return uploaded(file.name);
    });
    const view = await render(<CreateListingPhotosDescriptionPage />);

    await choose(view, photo('front.jpg'), photo('broken.jpg'));

    expect(shown(view)).toEqual([`${BUCKET}/front.jpg`]);
    expect(alertText(view)).toBe('broken.jpg: Unsupported file type. Allowed: image/jpeg, image/png');
  });

  it('uploads no more photos than a listing keeps, and says why the rest were not added', async () => {
    mockApi.uploads.propertyImage.mockImplementation(async (file: File) => uploaded(file.name));
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      photo_urls: Array.from({ length: 28 }, (_, index) => `${BUCKET}/saved-${index}.jpg`),
    }));
    const view = await render(<CreateListingPhotosDescriptionPage />);

    await choose(view, photo('a.jpg'), photo('b.jpg'), photo('c.jpg'));

    expect(mockApi.uploads.propertyImage).toHaveBeenCalledTimes(2);
    expect(draft().photo_urls).toHaveLength(30);
    expect(alertText(view)).toBe('c.jpg: a listing takes up to 30 photos.');
    expect(getByName(view, 'button', 'Add photos').hasAttribute('disabled')).toBe(true);
  });

  it('refuses a photo over 3 MB or a non-image without sending it', async () => {
    const view = await render(<CreateListingPhotosDescriptionPage />);

    await choose(view, photo('huge.jpg', 3 * 1024 * 1024 + 1), photo('lease.pdf', 10, 'application/pdf'));

    expect(mockApi.uploads.propertyImage).not.toHaveBeenCalled();
    expect(alertText(view)).toBe(
      'huge.jpg: photos can be up to 3 MB.lease.pdf: choose a JPEG, PNG, WebP or GIF image.',
    );
  });

  it('waits for uploads before moving on to the next step', async () => {
    const pending = deferred<UploadResult>();
    mockApi.uploads.propertyImage.mockReturnValue(pending.promise);
    const view = await render(<CreateListingPhotosDescriptionPage />);
    await choose(view, photo('front.jpg'));
    const next = descendants(view).find((element) => element.getAttribute('href') === '/owner/properties/create/terms') as FakeElement;

    expect(textOf(next)).toBe('Uploading…');
    await click(next);
    expect(navigation.navigate).not.toHaveBeenCalled();

    pending.resolve(uploaded('front.jpg'));
    await settle();
    expect(textOf(next)).toBe('Continue');
    await click(next);
    expect(navigation.navigate).toHaveBeenCalledWith('/owner/properties/create/terms');
    expect(draft().photo_urls).toEqual([`${BUCKET}/front.jpg`]);
  });

  it('drops inline photos an older draft kept and removes a photo from the draft', async () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      photo_urls: ['data:image/png;base64,iVBORw0KGgo=', `${BUCKET}/front.jpg`, `${BUCKET}/back.jpg`],
    }));
    const view = await render(<CreateListingPhotosDescriptionPage />);

    expect(shown(view)).toEqual([`${BUCKET}/front.jpg`, `${BUCKET}/back.jpg`]);
    await click(getByName(view, 'button', 'Remove photo 1'));
    expect(shown(view)).toEqual([`${BUCKET}/back.jpg`]);
    expect(draft().photo_urls).toEqual([`${BUCKET}/back.jpg`]);
  });

  it('keeps the features to what the API takes: up to 40, each up to 60 characters', async () => {
    const long = `Heated towel rails ${'and more '.repeat(5)}`.trim();
    expect(long.length).toBeGreaterThan(60);
    const features = Array.from({ length: 41 }, (_, index) => `Feature ${index + 1}`);
    mockApi.properties.amenities.mockResolvedValue([...features, long]);
    // An older draft chose 39, and one too long to save.
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ amenities: [...features.slice(0, 39), long] }));
    const view = await render(<CreateListingPhotosDescriptionPage />);
    const chip = (name: string) => getByName(view, 'button', name);

    expect(descendants(view).some((element) => element.tagName === 'BUTTON' && textOf(element) === long)).toBe(false);
    await click(chip('Feature 40'));

    expect(chip('Feature 40').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Feature 41').hasAttribute('disabled')).toBe(true);
    expect(textOf(view)).toContain('A listing keeps up to 40 features. Remove one to add another.');
    await click(chip('Feature 1'));
    expect(chip('Feature 41').hasAttribute('disabled')).toBe(false);
    await click(chip('Feature 41'));
    await click(descendants(view).find((element) => element.getAttribute('href') === '/owner/properties/create/terms')!);
    expect(draft().amenities).toEqual([...features.slice(1, 40), 'Feature 41']);
  });

  it("deletes a removed photo's file, which is public once uploaded, and keeps going if that fails", async () => {
    mockApi.uploads.propertyImage.mockImplementation(async (file: File) => uploaded(file.name));
    mockApi.uploads.discardPropertyImage.mockRejectedValueOnce(new ApiError(503, 'Storage is unavailable'));
    const view = await render(<CreateListingPhotosDescriptionPage />);
    await choose(view, photo('wrong.jpg'), photo('front.jpg'), photo('back.jpg'));

    await click(getByName(view, 'button', 'Remove photo 1'));
    await click(getByName(view, 'button', 'Remove photo 1'));
    await settle();

    expect(mockApi.uploads.discardPropertyImage.mock.calls).toEqual([[`${BUCKET}/wrong.jpg`], [`${BUCKET}/front.jpg`]]);
    expect(shown(view)).toEqual([`${BUCKET}/back.jpg`]);
    expect(draft().photo_urls).toEqual([`${BUCKET}/back.jpg`]);
  });
});
