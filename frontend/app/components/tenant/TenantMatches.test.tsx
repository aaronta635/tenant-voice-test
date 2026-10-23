import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { LandlordMatches, MatchFilter, PropertyMatch, PropertyMatches } from '@/app/lib/matching';
import TenantMatches from './TenantMatches';

const mocks = vi.hoisted(() => ({
  homes: vi.fn(), refine: vi.fn(), landlords: vi.fn(), save: vi.fn(), connection: vi.fn(),
}));
vi.mock('@/app/lib/matching', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/matching')>()),
  getPropertyMatches: mocks.homes,
  refinePropertyMatches: mocks.refine,
  getLandlordMatches: mocks.landlords,
  saveMatchEssentials: mocks.save,
}));
vi.mock('@/app/lib/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/connections')>()),
  getConnectionState: mocks.connection,
}));
vi.mock('next/image', () => ({ default: ({ alt, src }: { alt: string; src: string }) => <span role="img" aria-label={alt} data-src={src} /> }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const OLIVIA = 'c0000000-0000-4000-8000-000000000051';

function filters(overrides: Partial<Record<MatchFilter['key'], Partial<MatchFilter>>> = {}): MatchFilter[] {
  const base: MatchFilter[] = [
    { key: 'budget', essential: true, active: true, summary: 'Up to $650 a week' },
    { key: 'location', essential: true, active: true, summary: 'Newtown' },
    { key: 'pets', essential: true, active: false, summary: null },
    { key: 'bedrooms', essential: true, active: true, summary: 'At least 2 bedrooms' },
    { key: 'move_in', essential: true, active: false, summary: null },
  ];
  return base.map((filter) => ({ ...filter, ...overrides[filter.key] }));
}

function home(id: string, title: string, price: number, over: Partial<PropertyMatch> = {}): PropertyMatch {
  return {
    listing: {
      id, title, suburb: 'Newtown', state: 'NSW', postcode: '2042', property_type: 'apartment', price,
      bedrooms: 2, bathrooms: 1, parking: 1, pet_friendly: true, available_from: null, photo_url: null,
      published_at: '2026-10-20T00:00:00Z',
    },
    score: 92,
    match_level: 'strong',
    reasons: [`$${price} a week, within your $650 budget`, 'In Newtown, NSW: one of your preferred areas'],
    unmet: [],
    landlord: { id: OLIVIA, verified: true, rating_avg: 4.5, review_count: 2 },
    ...over,
  };
}

function matches(over: Partial<PropertyMatches> = {}): PropertyMatches {
  return {
    items: [home('l1', 'Harbour flat', 620), home('l2', 'Garden unit', 580, { score: 70, match_level: 'good' })],
    filters: filters(), has_preferences: true, considered: 5, excluded: { budget: 2, location: 1 },
    excluded_total: 3, source: 'rules', ai_status: 'not_configured',
    message: 'AI ordering is not connected yet. These homes are ordered by your preferences.',
    generated_at: '2026-10-23T00:00:00Z', cached: false, ...over,
  };
}

const LANDLORDS: LandlordMatches = {
  has_preferences: true, generated_at: '2026-10-23T00:00:00Z',
  items: [{
    id: OLIVIA, display_name: 'Olivia Owner', role_label: 'Landlord', avatar_url: null, areas: ['Newtown, NSW'],
    verified: true, rating_avg: 4.5, review_count: 2, listing_count: 1,
    listings: [{ id: 'l1', title: 'Harbour flat', suburb: 'Newtown', price: 620 }], score: 92,
    reasons: ['1 home of theirs meets all your musts', 'Best fit: Harbour flat, $620 a week'],
  }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.homes.mockResolvedValue(matches());
  mocks.landlords.mockResolvedValue(LANDLORDS);
  mocks.connection.mockResolvedValue({ user_id: OLIVIA, state: 'none', connection_id: null });
});
afterEach(cleanup);

const show = () => render(<div className="bg-white"><TenantMatches /></div>);
/** The card a heading names: the article around it. */
function card(view: FakeElement, title: string): FakeElement {
  let element: FakeElement | null = getByName(view, 'h3', title);
  while (element && element.tagName !== 'ARTICLE') element = element.parentElement;
  if (!element) throw new Error(`No card for ${title}`);
  return element;
}
const homeTitles = (view: FakeElement) =>
  descendants(getByName(view, 'ul', 'Matched homes')).filter((element) => element.tagName === 'H3').map(textOf);
/** A must's checkbox, by the preference it is for ("Suburbs Newtown"). */
function must(view: FakeElement, name: string): FakeElement {
  const label = descendants(view).find((element) => element.tagName === 'LABEL' && textOf(element) === name);
  const box = label && descendants(label).find((element) => element.tagName === 'INPUT');
  if (!box) throw new Error(`No must named ${name}`);
  return box;
}
const musts = (view: FakeElement) => descendants(view)
  .filter((element) => element.tagName === 'LABEL' && descendants(element).some((child) => child.tagName === 'INPUT'))
  .map(textOf);

describe('TenantMatches homes', () => {
  it('shows the homes the server matched, in its order, with the facts behind each', async () => {
    const view = await show();

    expect(mocks.homes).toHaveBeenCalledTimes(1);
    expect(homeTitles(view)).toEqual(['Harbour flat', 'Garden unit']);
    const harbour = card(view, 'Harbour flat');
    expect(textOf(harbour)).toContain('Strong match');
    expect(textOf(harbour)).toContain('$620 a week, within your $650 budget');
    expect(textOf(harbour)).toContain('In Newtown, NSW: one of your preferred areas');
    expect(textOf(harbour)).toContain('$620/wk');
    expect(textOf(harbour)).toContain('Rated 4.5 out of 5 from 2 reviews');
    // The visible label comes first in the name, so a voice command saying it finds the link (WCAG 2.5.3).
    expect(getByName(harbour, 'a', 'View home: Harbour flat').getAttribute('href')).toBe('/tenant/properties/l1');
  });

  it('says which nice-to-haves a home misses, and folds the reasons past the first four', async () => {
    mocks.homes.mockResolvedValue(matches({ items: [home('l1', 'Harbour flat', 620, {
      reasons: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'],
      unmet: ['In Glebe, NSW: outside your preferred areas'],
    })] }));
    const view = await show();

    const harbour = card(view, 'Harbour flat');
    expect(textOf(harbour)).toContain('Nice-to-haves it misses');
    expect(textOf(harbour)).toContain('In Glebe, NSW: outside your preferred areas');
    const more = descendants(harbour).find((element) => element.tagName === 'DETAILS') as FakeElement;
    expect(textOf(descendants(more).find((element) => element.tagName === 'SUMMARY') as FakeElement)).toBe('2 more reasons');
    expect(descendants(more).filter((element) => element.tagName === 'LI').map(textOf)).toEqual(['Five', 'Six']);
    expect(descendants(harbour).filter((element) => element.tagName === 'LI').map(textOf).slice(0, 4))
      .toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('links to the preferences the matches come from', async () => {
    const view = await show();

    expect(getByName(view, 'a', 'Edit your preferences').getAttribute('href')).toBe('/tenant/rental-preferences');
  });

  it('orders the same homes by price on request, without leaving any out', async () => {
    const view = await show();
    const select = descendants(view).find((element) => element.tagName === 'SELECT') as FakeElement;

    select.value = 'price_asc';
    await dispatch(select, 'change');

    expect(homeTitles(view)).toEqual(['Garden unit', 'Harbour flat']);
  });

  it('says it is looking while the matches load', async () => {
    mocks.homes.mockReturnValue(new Promise(() => {}));
    const view = await show();

    expect(textOf(view)).toContain('Finding homes that match your preferences…');
  });

  it('offers a retry when the matches cannot be loaded', async () => {
    mocks.homes.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await show();

    expect(textOf(view)).toContain('Your matches could not be loaded');
    expect(textOf(view)).toContain('The service is temporarily unavailable. Please try again.');
    await click(getByName(view, 'button', 'Try again'));

    expect(homeTitles(view)).toEqual(['Harbour flat', 'Garden unit']);
  });

  it('asks for preferences before there is anything to match', async () => {
    mocks.homes.mockResolvedValue(matches({ items: [], has_preferences: false, considered: 0, excluded: {}, excluded_total: 0 }));
    const view = await show();

    expect(textOf(view)).toContain('Tell us what you are looking for');
    expect(getByName(view, 'a', 'Add your preferences').getAttribute('href')).toBe('/tenant/rental-preferences');
    expect(textOf(view)).not.toContain('Landlords with homes for you');
  });

  it('says what each must left out when no home meets them all', async () => {
    mocks.homes.mockResolvedValue(matches({ items: [], considered: 3, excluded: { budget: 2, location: 1 }, excluded_total: 3 }));
    mocks.landlords.mockResolvedValue({ ...LANDLORDS, items: [] });
    const view = await show();

    expect(textOf(view)).toContain('No homes meet all your musts right now');
    expect(textOf(view)).toContain('Of 3 listed homes: 2 over your budget, 1 outside your areas.');
    expect(textOf(view)).toContain('No landlords to suggest yet: none has a home that meets all your musts.');
  });

  it('keeps the matches at AA contrast, also under the pointer', async () => {
    mocks.homes.mockResolvedValue(matches({ items: [
      home('l1', 'Harbour flat', 620, { unmet: ['Not listed as pet-friendly'] }),
      home('l2', 'Garden unit', 580, { score: 70, match_level: 'good' }),
      home('l3', 'Back flat', 560, { score: 50, match_level: 'fair', landlord: null }),
    ], ai_status: 'ready', message: null }));
    const view = await show();

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

describe('TenantMatches musts', () => {
  it('saves a must marked nice to have and shows the homes it lets in', async () => {
    mocks.save.mockResolvedValue(matches({
      items: [...matches().items, home('l3', 'Glebe terrace', 600, {
        score: 64, match_level: 'good', unmet: ['In Glebe, NSW: outside your preferred areas'],
      })],
      filters: filters({ location: { essential: false } }),
    }));
    const view = await show();
    expect(mocks.landlords).toHaveBeenCalledTimes(1);

    const suburbs = must(view, 'Suburbs Newtown');
    suburbs.checked = false;
    await click(suburbs);
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

    expect(mocks.save).toHaveBeenCalledWith(['budget', 'pets', 'bedrooms', 'move_in']);
    expect(homeTitles(view)).toEqual(['Harbour flat', 'Garden unit', 'Glebe terrace']);
    expect(textOf(view)).toContain('Your musts are saved.');
    // The landlords follow the musts too.
    expect(mocks.landlords).toHaveBeenCalledTimes(2);
  });

  it('offers a must for each preference set, and names the ones not set yet', async () => {
    const view = await show();

    expect(textOf(view)).toContain('Not set yet: pets, move-in date.');
    expect(musts(view)).toEqual(['Weekly budget Up to $650 a week', 'Suburbs Newtown', 'Bedrooms At least 2 bedrooms']);
    expect(must(view, 'Weekly budget Up to $650 a week').checked).toBe(true);
  });

  it('says so when the musts cannot be saved', async () => {
    mocks.save.mockRejectedValueOnce(new ApiError(409, 'Your profile changed while this was saving. Please try again.'));
    const view = await show();

    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');

    expect(textOf(view)).toContain('Your profile changed while this was saving. Please try again.');
    expect(homeTitles(view)).toEqual(['Harbour flat', 'Garden unit']);
  });
});

describe('TenantMatches AI order', () => {
  it('says the AI is not connected instead of offering it', async () => {
    const view = await show();

    expect(textOf(view)).toContain('AI ordering is not connected yet. These homes are ordered by your preferences.');
    expect(descendants(view).some((element) => element.tagName === 'BUTTON' && textOf(element) === 'Refine order with AI')).toBe(false);
  });

  it('asks the server to refine the order and shows what it answered', async () => {
    mocks.homes.mockResolvedValue(matches({ ai_status: 'ready', message: null }));
    mocks.refine.mockResolvedValue(matches({
      items: [...matches().items].reverse(), source: 'ai', ai_status: 'applied',
      message: 'AI refined the order. The reasons are facts from each listing.',
    }));
    const view = await show();
    expect(textOf(view)).toContain('Ordered by how well each home fits your preferences.');

    await click(getByName(view, 'button', 'Refine order with AI'));

    expect(mocks.refine).toHaveBeenCalledTimes(1);
    expect(homeTitles(view)).toEqual(['Garden unit', 'Harbour flat']);
    expect(textOf(view)).toContain('AI refined the order. The reasons are facts from each listing.');
    expect(descendants(view).some((element) => element.tagName === 'BUTTON' && textOf(element) === 'Refine order with AI')).toBe(false);
  });

  it('says why the AI order needs a verified account, keeps the homes and points to the documents', async () => {
    const gate = {
      code: 'verification_required' as const, action: 'paid_ai', status: 'pending', documents_href: '/tenant/id-verification',
      message: 'Your account needs to be verified before you can use AI features. Upload the documents it asks for, or wait for the review to finish.',
    };
    mocks.homes.mockResolvedValue(matches({ ai_status: 'ready', message: null }));
    mocks.refine.mockResolvedValue(matches({
      ai_status: 'verification_required', verification: gate,
      message: 'AI ordering needs a verified account. These homes are ordered by your preferences.',
    }));
    const view = await show();

    await click(getByName(view, 'button', 'Refine order with AI'));

    const refusal = descendants(view).find((element) => element.id === 'matches-ai-refusal');
    expect(refusal?.getAttribute('role')).toBe('alert');
    expect(textOf(refusal!)).toContain('Verification needed');
    expect(textOf(refusal!)).toContain(gate.message);
    expect(getByName(refusal!, 'a', 'Go to your documents').getAttribute('href')).toBe('/tenant/id-verification');
    expect(textOf(view)).toContain('AI ordering needs a verified account. These homes are ordered by your preferences.');
    expect(homeTitles(view)).toEqual(['Harbour flat', 'Garden unit']);
    // The button cannot help until the account is verified; focus moves to the reason instead.
    expect(descendants(view).some((element) => element.tagName === 'BUTTON' && textOf(element) === 'Refine order with AI')).toBe(false);
    expect(view.ownerDocument?.activeElement).toBe(refusal);
  });

  it('says up front why an unverified tenant gets no AI order, without a button or a focus move', async () => {
    const gate = {
      code: 'verification_required' as const, action: 'paid_ai', status: 'rejected', documents_href: '/tenant/id-verification',
      message: 'Your account needs to be verified before you can use AI features. A document was rejected: replace it to send it for review again.',
    };
    mocks.homes.mockResolvedValue(matches({
      ai_status: 'verification_required', verification: gate,
      message: 'AI ordering needs a verified account. These homes are ordered by your preferences.',
    }));
    const view = await show();

    const refusal = descendants(view).find((element) => element.id === 'matches-ai-refusal');
    expect(textOf(refusal!)).toContain('A document needs replacing');
    expect(textOf(refusal!)).toContain(gate.message);
    expect(getByName(refusal!, 'a', 'Go to your documents').getAttribute('href')).toBe('/tenant/id-verification');
    expect(homeTitles(view)).toEqual(['Harbour flat', 'Garden unit']);
    expect(descendants(view).some((element) => element.tagName === 'BUTTON' && textOf(element) === 'Refine order with AI')).toBe(false);
    expect(mocks.refine).not.toHaveBeenCalled();
    // Shown with the page, the reason leaves focus where the page put it.
    expect(view.ownerDocument?.activeElement).not.toBe(refusal);
    expect(lowContrastText(refusal!)).toEqual([]);
  });

  it('keeps the homes when refining fails', async () => {
    mocks.homes.mockResolvedValue(matches({ ai_status: 'ready', message: null }));
    mocks.refine.mockRejectedValueOnce(new ApiError(0, 'Could not connect. Check your connection and try again.'));
    const view = await show();

    await click(getByName(view, 'button', 'Refine order with AI'));

    expect(textOf(view)).toContain('Could not connect. Check your connection and try again.');
    expect(homeTitles(view)).toEqual(['Harbour flat', 'Garden unit']);
  });
});

describe('TenantMatches landlords', () => {
  it('suggests landlords with the homes of theirs that fit, their badges and a way to connect', async () => {
    const view = await show();
    await act(async () => { await settle(); });

    const olivia = card(view, 'Olivia Owner');
    expect(textOf(olivia)).toContain('1 home of theirs meets all your musts');
    expect(textOf(olivia)).toContain('Rated 4.5 out of 5 from 2 reviews');
    expect(getByName(olivia, 'a', /Harbour flat, Newtown/).getAttribute('href')).toBe('/tenant/properties/l1');
    expect(getByName(olivia, 'a', 'View profile: Olivia Owner').getAttribute('href')).toBe(`/public/${OLIVIA}`);
    expect(getByName(olivia, 'button', 'Connect with Olivia Owner')).toBeTruthy();
    expect(mocks.connection).toHaveBeenCalledWith(OLIVIA);
  });

  it('offers a retry when the landlords cannot be loaded, and keeps the homes', async () => {
    mocks.landlords.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await show();

    expect(textOf(view)).toContain('Landlord suggestions could not be loaded');
    expect(homeTitles(view)).toEqual(['Harbour flat', 'Garden unit']);
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Olivia Owner');
  });
});
