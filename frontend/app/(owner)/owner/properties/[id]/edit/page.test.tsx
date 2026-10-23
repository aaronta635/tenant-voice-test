import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Property, type UploadResult } from '@/app/lib/api';
import EditListingPage from './page';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const mockApi = vi.hoisted(() => ({
  properties: { getMine: vi.fn(), update: vi.fn(), remove: vi.fn(), amenities: vi.fn(), uploadPhoto: vi.fn() },
  uploads: { discardPropertyImage: vi.fn() },
}));

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'pr-1' }), useRouter: () => ({ push: navigation.push }) }));
// next/image needs the Next runtime; a plain img shows the same source.
// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/app/lib/api')>()), api: mockApi }));

const BUCKET = 'https://example.supabase.co/storage/v1/object/public/property-images/owner';
const SAVED = [`${BUCKET}/front.jpg`, `${BUCKET}/kitchen.jpg`];

function listing(over: Partial<Property> = {}): Property {
  return {
    id: 'pr-1', owner_id: 'owner-1', title: 'Harbour flat', description: 'Sunny.', address: '1 Harbour Street, Wollongong, NSW, 2500',
    street_address: '1 Harbour Street', suburb: 'Wollongong', state: 'NSW', postcode: '2500', property_type: 'apartment',
    bedrooms: 2, bathrooms: 1, parking: 1, price: 650, bond: 2600, lease_term: '12 months', available_from: '2026-11-01',
    amenities: ['Balcony'], photo_urls: SAVED, status: 'available', listing_status: 'published', rating_avg: 0, review_count: 0,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over,
  };
}

/** The control a visible <label> names. */
function field(view: FakeElement, text: RegExp): FakeElement {
  const label = descendants(view).find((element) => element.tagName === 'LABEL' && text.test(textOf(element)));
  if (!label) throw new Error(`No label reads ${text}`);
  return descendants(view).find((element) => element.id === label.getAttribute('for')) as FakeElement;
}

async function choose(control: FakeElement, value: string) {
  control.value = value;
  await dispatch(control, 'change');
}

async function save(view: FakeElement) {
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
}

const shown = (view: FakeElement) =>
  descendants(view).filter((element) => element.tagName === 'IMG').map((image) => image.getAttribute('src'));
const photo = (name: string, bytes = 10, type = 'image/jpeg') => new File([new Uint8Array(bytes)], name, { type });
const uploaded = (name: string): UploadResult => ({ url: `${BUCKET}/${name}`, path: `owner/${name}`, content_type: 'image/jpeg', size: 10 });

async function addPhotos(view: FakeElement, ...files: File[]) {
  const input = getByName(view, 'input', 'Add listing photos');
  input.files = files;
  await dispatch(input, 'change');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockApi.properties.getMine.mockResolvedValue(listing());
  mockApi.properties.amenities.mockResolvedValue(['Balcony', 'Garage']);
  mockApi.properties.update.mockImplementation(async (_id: string, changes: Partial<Property>) => listing(changes));
  mockApi.properties.uploadPhoto.mockImplementation(async (_id: string, file: File) => uploaded(file.name));
  mockApi.uploads.discardPropertyImage.mockResolvedValue(undefined);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the edit listing page', () => {
  it('opens every field of the listing as it is saved', async () => {
    const view = await render(<EditListingPage />);

    expect(field(view, /^Title/).value).toBe('Harbour flat');
    expect(field(view, /^Street address/).value).toBe('1 Harbour Street');
    expect(field(view, /^Suburb/).value).toBe('Wollongong');
    expect(field(view, /^State/).value).toBe('NSW');
    expect(field(view, /^Postcode/).value).toBe('2500');
    expect(field(view, /^Property type/).value).toBe('apartment');
    expect(field(view, /^Bedrooms/).value).toBe('2');
    expect(field(view, /^Weekly rent/).value).toBe('650');
    expect(field(view, /^Bond/).value).toBe('2600');
    expect(field(view, /^Lease term/).value).toBe('12 months');
    expect(field(view, /^Available from/).value).toBe('2026-11-01');
    expect(getByName(view, 'button', 'Balcony').getAttribute('aria-pressed')).toBe('true');
    expect(getByName(view, 'button', 'Garage').getAttribute('aria-pressed')).toBe('false');
    expect(shown(view)).toEqual(SAVED);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('says what signed-out visitors see of the address, and that the description is public', async () => {
    const view = await render(<EditListingPage />);

    expect(textOf(view)).toContain(
      'Signed-out visitors see only the suburb, state and postcode, and a title that names the street is replaced for them.',
    );
    expect(textOf(view)).toContain('The description is shown to everyone as you write it, so leave the street out of it.');
  });

  it('sends only what changed, and an emptied field as null to clear it', async () => {
    const view = await render(<EditListingPage />);

    await typeInto(field(view, /^Title/), 'Harbour view flat');
    await typeInto(field(view, /^Bond/), '');
    await typeInto(field(view, /^Lease term/), '');
    await choose(field(view, /^Property type/), 'unit');
    await click(getByName(view, 'button', 'Garage'));
    await save(view);

    expect(mockApi.properties.update).toHaveBeenCalledWith('pr-1', {
      title: 'Harbour view flat', bond: null, lease_term: null, property_type: 'unit', amenities: ['Balcony', 'Garage'],
    });
    expect(textOf(view)).toContain('Changes saved.');
  });

  it('refuses to clear a field the listing needs', async () => {
    const view = await render(<EditListingPage />);

    await typeInto(field(view, /^Suburb/), '  ');
    await save(view);

    expect(mockApi.properties.update).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Add the suburb.');
  });

  it('adds photos as they upload, makes one the cover, and removes a saved one on save', async () => {
    const view = await render(<EditListingPage />);

    await addPhotos(view, photo('garden.jpg'));
    // The listing exists: its photo goes to its property's folder, as the mobile app keeps them.
    expect(mockApi.properties.uploadPhoto).toHaveBeenCalledWith('pr-1', expect.objectContaining({ name: 'garden.jpg' }));
    expect(shown(view)).toEqual([...SAVED, `${BUCKET}/garden.jpg`]);
    await click(getByName(view, 'button', 'Make photo 3 the cover'));
    await click(getByName(view, 'button', 'Remove photo 3'));
    expect(shown(view)).toEqual([`${BUCKET}/garden.jpg`, SAVED[0]]);
    await save(view);

    expect(mockApi.properties.update).toHaveBeenCalledWith('pr-1', { photo_urls: [`${BUCKET}/garden.jpg`, SAVED[0]] });
    // A saved photo goes with the save, which deletes its file: nothing is discarded here.
    expect(mockApi.uploads.discardPropertyImage).not.toHaveBeenCalled();
  });

  it('deletes a photo uploaded and removed before saving, which is public once uploaded', async () => {
    const view = await render(<EditListingPage />);

    await addPhotos(view, photo('wrong.jpg'));
    await click(getByName(view, 'button', 'Remove photo 3'));
    await settle();

    expect(mockApi.uploads.discardPropertyImage).toHaveBeenCalledWith(`${BUCKET}/wrong.jpg`);
    expect(shown(view)).toEqual(SAVED);
  });

  it('refuses a photo the bucket would, without sending it', async () => {
    const view = await render(<EditListingPage />);

    await addPhotos(view, photo('huge.jpg', 3 * 1024 * 1024 + 1), photo('lease.pdf', 10, 'application/pdf'));

    expect(mockApi.properties.uploadPhoto).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('huge.jpg: photos can be up to 3 MB.');
    expect(textOf(view)).toContain('lease.pdf: choose a JPEG, PNG, WebP or GIF image.');
  });

  it('keeps a listing to the photos and features the API takes, uploading nothing past them', async () => {
    const many = Array.from({ length: 29 }, (_, index) => `${BUCKET}/saved-${index}.jpg`);
    const features = Array.from({ length: 40 }, (_, index) => `Feature ${index + 1}`);
    mockApi.properties.getMine.mockResolvedValue(listing({ photo_urls: many, amenities: features }));
    const view = await render(<EditListingPage />);

    await addPhotos(view, photo('a.jpg'), photo('b.jpg'));

    expect(mockApi.properties.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(shown(view)).toHaveLength(30);
    expect(textOf(view)).toContain('b.jpg: a listing takes up to 30 photos.');
    expect(getByName(view, 'button', 'Add photos').hasAttribute('disabled')).toBe(true);
    expect(getByName(view, 'button', 'Add feature').hasAttribute('disabled')).toBe(true);
    expect(getByName(view, 'button', 'Garage').hasAttribute('disabled')).toBe(true);
    expect(textOf(view)).toContain('A listing keeps up to 40 features. Remove one to add another.');
    // Taking one off makes room again.
    await click(getByName(view, 'button', 'Feature 1'));
    expect(getByName(view, 'button', 'Garage').hasAttribute('disabled')).toBe(false);
  });

  it('offers no feature longer than the API keeps, which another app may have saved', async () => {
    const long = 'Close to the beach, shops, schools, the station and the hospital';
    expect(long.length).toBeGreaterThan(60);
    mockApi.properties.amenities.mockResolvedValue(['Balcony', 'Garage', long]);
    const view = await render(<EditListingPage />);

    expect(getByName(view, 'button', 'Garage').getAttribute('aria-pressed')).toBe('false');
    expect(descendants(view).some((element) => element.tagName === 'BUTTON' && textOf(element) === long)).toBe(false);
  });

  it('leaves for the listing page, deleting photos it uploaded and did not save', async () => {
    const view = await render(<EditListingPage />);

    await addPhotos(view, photo('extra.jpg'));
    await click(getByName(view, 'button', 'Back to the listing'));

    expect(mockApi.uploads.discardPropertyImage).toHaveBeenCalledWith(`${BUCKET}/extra.jpg`);
    expect(navigation.push).toHaveBeenCalledWith('/owner/properties/pr-1');
  });

  it("shows the server's answer when a save is refused, and keeps the edits", async () => {
    mockApi.properties.update.mockRejectedValue(new ApiError(422, 'Enter the lease term as a number of months or years, such as 12 months.'));
    const view = await render(<EditListingPage />);

    await typeInto(field(view, /^Lease term/), 'Flexible');
    await save(view);

    expect(textOf(view)).toContain('Enter the lease term as a number of months or years');
    expect(field(view, /^Lease term/).value).toBe('Flexible');
  });

  it('changes the status from the edit page', async () => {
    mockApi.properties.update.mockResolvedValue(listing({ listing_status: 'applications_closed' }));
    const view = await render(<EditListingPage />);

    await click(getByName(view, 'button', 'Close applications'));
    const dialog = descendants(view).find((element) => element.tagName === 'DIALOG' && element.hasAttribute('open')) as FakeElement;
    await click(getByName(dialog, 'button', 'Close applications'));

    expect(mockApi.properties.update).toHaveBeenCalledWith('pr-1', { listing_status: 'applications_closed' });
    expect(textOf(view)).toContain('Harbour flat is closed to new applications.');
    expect(getByName(view, 'button', 'Reopen applications')).toBeTruthy();
  });

  it('shows not found for a listing that is not the owner’s', async () => {
    mockApi.properties.getMine.mockRejectedValue(new ApiError(404, 'Property not found'));

    const view = await render(<EditListingPage />);

    expect(textOf(view)).toContain('Listing not found');
    expect(descendants(view).filter((element) => element.tagName === 'FORM')).toEqual([]);
  });
});
