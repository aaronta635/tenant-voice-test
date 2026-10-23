import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Property } from '@/app/lib/api';
import { componentNamed, findAll, mount, textOf } from '@/app/test-utils/shallow-render';
import PropertyMarketplace from './PropertyMarketplace';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  ...(await import('@/app/test-utils/shallow-render')).fakeHooks,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { properties: { listPublic: async () => [listing] } },
}));

const listing = {
  id: 'pr-42', title: 'Modern Loft in Newtown', address: '18 Wilson St', suburb: 'Newtown', state: 'NSW',
  status: 'available', price: 720, bond: 2880, bedrooms: 2, bathrooms: 2, parking: 1,
  available_from: null, amenities: [], photo_urls: [], description: null,
} as unknown as Property;

// Accounts are created as "Landlord", and /properties asks guests to sign in to message the landlord.
const STORED_PHOTO = 'https://abcd.supabase.co/storage/v1/object/public/property-images/owner/1.png';

async function cardPhotos(photoUrls: string[]) {
  listing.photo_urls = photoUrls;
  const marketplace = mount(PropertyMarketplace, {});
  marketplace.render();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return findAll(marketplace.render(), (element) => typeof element.props.src === 'string').map((element) => element.props);
}

describe('PropertyMarketplace listing photos', () => {
  afterEach(() => {
    listing.photo_urls = [];
  });

  it('loads a photo from the shared storage as is, which next/image would refuse to optimise', async () => {
    expect(await cardPhotos([STORED_PHOTO])).toEqual([expect.objectContaining({ src: STORED_PHOTO, unoptimized: true })]);
  });

  it('says "No photo yet" for a listing without photos, never showing a stock photo for it', async () => {
    expect(await cardPhotos([])).toEqual([]);
    const marketplace = mount(PropertyMarketplace, {});
    marketplace.render();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(findAll(marketplace.render(), componentNamed('NoPhotoYet'))).toHaveLength(1);
  });
});

describe('PropertyMarketplace listing cards', () => {
  afterEach(() => {
    Object.assign(listing, { bedrooms: 2, bathrooms: 2 });
  });

  it('counts one bedroom and one bathroom in the singular', async () => {
    Object.assign(listing, { bedrooms: 1, bathrooms: 1 });
    const marketplace = mount(PropertyMarketplace, {});
    marketplace.render();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const texts = findAll(marketplace.render(), () => true).map(textOf);
    expect(texts).toEqual(expect.arrayContaining(['1 bed', '1 bath']));
    expect(texts.filter((text) => /\b1 (beds|baths)\b/.test(text))).toEqual([]);
  });

  it('counts more in the plural', async () => {
    const marketplace = mount(PropertyMarketplace, {});
    marketplace.render();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(findAll(marketplace.render(), () => true).map(textOf)).toEqual(expect.arrayContaining(['2 beds', '2 baths']));
  });

  it('ask guests to contact the landlord when a listing has no available date', async () => {
    const marketplace = mount(PropertyMarketplace, {});
    marketplace.render();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Each element's text, as textOf runs neighbours together.
    const texts = findAll(marketplace.render(), () => true).map(textOf);
    expect(texts).toContain('Available Contact landlord');
    expect(texts.filter((text) => /\bowners?\b/i.test(text))).toEqual([]);
  });
});

describe('PropertyMarketplace links and addresses', () => {
  async function cards(props: { basePath?: string } = {}) {
    const marketplace = mount(PropertyMarketplace, props);
    marketplace.render();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return marketplace.render();
  }

  afterEach(() => {
    Object.assign(listing, { address: '18 Wilson St', address_hidden: undefined });
  });

  it('opens a listing in the workspace by default and on the public page when told to', async () => {
    const hrefs = async (props: { basePath?: string }) =>
      findAll(await cards(props), (element) => typeof element.props.href === 'string').map((element) => element.props.href);

    expect(await hrefs({})).toEqual(['/tenant/properties/pr-42']);
    expect(await hrefs({ basePath: '/properties' })).toEqual(['/properties/pr-42']);
  });

  it('shows a signed-out visitor the suburb, never a street, and a member the address the API sends', async () => {
    const texts = async () => findAll(await cards(), () => true).map(textOf);

    expect(await texts()).toContain('Newtown, NSW');
    expect((await texts()).filter((text) => text.includes('Wilson'))).toEqual([]);
    Object.assign(listing, { address: '18 Wilson St, Newtown, NSW, 2042', address_hidden: false });
    expect(await texts()).toContain('18 Wilson St, Newtown, NSW, 2042');
  });
});
