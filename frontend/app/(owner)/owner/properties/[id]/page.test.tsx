import { cleanup, click, descendants, fire, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Application, type Property } from '@/app/lib/api';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import PropertyDetailsPage from './page';

const navigation = vi.hoisted(() => ({ page: null as FakeHistory | null, push: vi.fn() }));
const mockApi = vi.hoisted(() => ({
  properties: { getMine: vi.fn(), update: vi.fn(), remove: vi.fn() },
  applications: { listForProperty: vi.fn(), update: vi.fn(), documentLink: vi.fn() },
  conversations: { startRental: vi.fn() },
}));
const inspections = vi.hoisted(() => ({ owner: vi.fn(), records: vi.fn(), attendees: vi.fn() }));

vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useParams: () => ({ id: 'pr-1' }),
    useRouter: () => ({ push: navigation.push, refresh: vi.fn() }),
    useSearchParams: () => {
      const search = useSyncExternalStore(
        (listener) => navigation.page?.subscribe(listener) ?? (() => {}),
        () => navigation.page?.search ?? '',
      );
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
// next/image needs the Next runtime; a plain img shows the same source.
// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/app/lib/api')>()), api: mockApi }));
vi.mock('@/app/lib/inspections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/inspections')>()),
  inspectionsApi: inspections,
}));

function listing(over: Partial<Property> = {}): Property {
  return {
    id: 'pr-1', owner_id: 'owner-1', title: 'Harbour flat', description: 'Sunny.', address: '1 Harbour Street, Wollongong, NSW, 2500',
    street_address: '1 Harbour Street', suburb: 'Wollongong', state: 'NSW', postcode: '2500', property_type: 'apartment',
    bedrooms: 2, bathrooms: 1, parking: 1, price: 650, bond: 2600, lease_term: '12 months', available_from: null,
    amenities: ['Balcony'], photo_urls: [], status: 'available', listing_status: 'published', rating_avg: 0, review_count: 0,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', application_count: 1, new_application_count: 1,
    ...over,
  };
}

function application(over: Partial<Application> = {}): Application {
  return {
    id: 'app-1', property_id: 'pr-1', tenant_id: 'tenant-1', status: 'new', stage: 'submitted', can_withdraw: true,
    annual_income: null, move_in_date: '2026-11-15', occupants: 2, rent_offered: 620, tenant_score: null, shortlisted: false,
    has_pets: true, pets: 'One indoor cat', about: 'Nurse at the local hospital.', message: 'Can move in early.',
    documents: [{ id: 'att-1', document_type: 'PASSPORT', label: 'Passport', verified: true, shared: true }],
    history: [{ from_stage: null, to_stage: 'submitted', note: null, by: 'applicant', created_at: '2026-10-01T00:00:00Z' }],
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', tenant_name: 'Tanya Tenant', tenant_phone: null,
    tenant_verified: true, tenant_rating_avg: 4.5, tenant_review_count: 2, ...over,
  };
}

let leavePage = () => {};
async function open(href = '/owner/properties/pr-1') {
  const page = createFakeHistory(href);
  leavePage = page.install(window);
  navigation.page = page;
  const view = await render(<PropertyDetailsPage />);
  return { page, view };
}

async function land(page: FakeHistory) {
  await act(async () => { page.land(); });
  await settle();
}

const dialogs = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'DIALOG' && element.hasAttribute('open'));
const tab = (view: FakeElement, name: RegExp) => descendants(view).find((element) => element.getAttribute('role') === 'tab' && name.test(textOf(element))) as FakeElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  mockApi.properties.getMine.mockResolvedValue(listing());
  mockApi.applications.listForProperty.mockResolvedValue([application()]);
  inspections.owner.mockResolvedValue({ slots: [], bookings: [] });
  inspections.records.mockResolvedValue([]);
  inspections.attendees.mockResolvedValue([]);
});
afterEach(async () => {
  await cleanup();
  leavePage();
  navigation.page = null;
  vi.unstubAllGlobals();
});

describe('the owner listing page', () => {
  it('shows the listing with its status, edit link and public page', async () => {
    const { view } = await open();

    expect(textOf(view)).toContain('Published');
    expect(getByName(view, 'a', 'Edit listing').getAttribute('href')).toBe('/owner/properties/pr-1/edit');
    expect(getByName(view, 'a', 'View public page').getAttribute('href')).toBe('/properties/pr-1');
    expect(tab(view, /^Details/).getAttribute('aria-selected')).toBe('true');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('opens the applications tab, keeps it in the address, and moves between tabs with the arrow keys', async () => {
    const { page, view } = await open();

    await click(tab(view, /^Applications \(1\)$/));
    await land(page);
    expect(page.stack()).toEqual(['>/owner/properties/pr-1?tab=applications']);
    expect(tab(view, /^Applications/).getAttribute('aria-selected')).toBe('true');
    expect(textOf(view)).toContain('Tanya Tenant');

    await act(async () => { fire(tab(view, /^Applications/), 'keydown', { key: 'ArrowLeft' }); });
    await land(page);
    expect(page.stack()).toEqual(['>/owner/properties/pr-1']);
    expect(tab(view, /^Details/).getAttribute('aria-selected')).toBe('true');
  });

  it("shows each applicant's badge, rating and what they chose to share", async () => {
    const { view } = await open('/owner/properties/pr-1?tab=applications');

    const [card] = descendants(view).filter((element) => element.tagName === 'ARTICLE');
    const text = textOf(card);
    expect(getByName(card, 'span', 'Verified by TenantVoice')).toBeTruthy();
    expect(text).toContain('Rated 4.5 out of 5 from 2 reviews');
    expect(text).toContain('Move-in date15 Nov 2026');
    expect(text).toContain('People living there2');
    expect(text).toContain('PetsOne indoor cat');
    expect(text).toContain('Offer$620 a week (asking $650)');
    expect(text).toContain('Nurse at the local hospital.');
    expect(text).toContain('Can move in early.');
    expect(text).toContain('Passport · Verified by TenantVoice');
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });

  it('opens a shared document through a link signed when it is clicked', async () => {
    const tabWindow = { closed: false, opener: {}, location: { href: '' }, close: vi.fn() };
    Object.assign(window, { open: vi.fn(() => tabWindow) });
    mockApi.applications.documentLink.mockResolvedValue({ url: 'https://storage.example.test/signed', expires_in: 300 });
    const { view } = await open('/owner/properties/pr-1?tab=applications');

    await click(getByName(view, 'button', 'Open Passport from Tanya Tenant'));

    expect(mockApi.applications.documentLink).toHaveBeenCalledWith('app-1', 'att-1');
    expect(tabWindow.location.href).toBe('https://storage.example.test/signed');
    expect(tabWindow.opener).toBeNull();
  });

  it('shortlists an applicant', async () => {
    mockApi.applications.update.mockResolvedValue(application({ status: 'reviewing', stage: 'shortlisted', shortlisted: true }));
    const { view } = await open('/owner/properties/pr-1?tab=applications');

    await click(getByName(view, 'button', 'Shortlist Tanya Tenant'));

    expect(mockApi.applications.update).toHaveBeenCalledWith('app-1', { shortlisted: true });
    expect(textOf(view)).toContain('Tanya Tenant is on your shortlist.');
    expect(descendants(view).filter((element) => element.getAttribute('aria-label') === 'Shortlist Tanya Tenant')).toEqual([]);
  });

  it('declines with a note to the applicant, and the history shows it', async () => {
    mockApi.applications.update.mockResolvedValue(application({
      status: 'declined', stage: 'declined', can_withdraw: false, documents: [],
      history: [
        { from_stage: null, to_stage: 'submitted', note: null, by: 'applicant', created_at: '2026-10-01T00:00:00Z' },
        { from_stage: 'submitted', to_stage: 'declined', note: 'We chose a family.', by: 'landlord', created_at: '2026-10-02T00:00:00Z' },
      ],
    }));
    const { view } = await open('/owner/properties/pr-1?tab=applications');

    await click(getByName(view, 'button', 'Decline Tanya Tenant'));
    const [dialog] = dialogs(view);
    expect(textOf(dialog)).toContain('Decline this application?');
    await typeInto(descendants(dialog).find((element) => element.tagName === 'TEXTAREA') as FakeElement, 'We chose a family.');
    await click(getByName(dialog, 'button', 'Decline'));

    expect(mockApi.applications.update).toHaveBeenCalledWith('app-1', { status: 'declined', note: 'We chose a family.' });
    expect(dialogs(view)).toEqual([]);
    const [card] = descendants(view).filter((element) => element.tagName === 'ARTICLE');
    expect(textOf(card)).toContain('Application declined. The applicant has been told.');
    expect(textOf(card)).toContain('Declined by you');
    expect(textOf(card)).toContain('“We chose a family.”');
    expect(descendants(card).filter((element) => /^(Approve|Decline) /.test(element.getAttribute('aria-label') ?? ''))).toEqual([]);
  });

  it("says why a decision was refused and keeps the dialog open", async () => {
    mockApi.applications.update.mockRejectedValue(new ApiError(409, 'This application was withdrawn or has expired, so it can no longer be decided.'));
    const { view } = await open('/owner/properties/pr-1?tab=applications');

    await click(getByName(view, 'button', 'Approve Tanya Tenant'));
    await click(getByName(dialogs(view)[0], 'button', 'Approve'));

    expect(textOf(dialogs(view)[0])).toContain('can no longer be decided');
  });

  it('approves after saying it leases the listing, then reads the listing and its applications again', async () => {
    const approved = application({ status: 'approved', stage: 'approved', can_withdraw: false });
    mockApi.applications.update.mockResolvedValue(approved);
    const { view } = await open('/owner/properties/pr-1?tab=applications');
    mockApi.properties.getMine.mockResolvedValue(listing({ listing_status: 'leased', status: 'rented' }));
    mockApi.applications.listForProperty.mockResolvedValue([approved, application({
      id: 'app-2', tenant_name: 'Theo Tenant', status: 'declined', stage: 'declined', can_withdraw: false,
    })]);

    await click(getByName(view, 'button', 'Approve Tanya Tenant'));
    const [dialog] = dialogs(view);
    expect(textOf(dialog)).toContain('Approving leases Harbour flat: it leaves the public listings, and every other open application is declined');
    await click(getByName(dialog, 'button', 'Approve'));
    await settle();

    expect(mockApi.applications.update).toHaveBeenCalledWith('app-1', { status: 'approved', note: null });
    expect([mockApi.properties.getMine.mock.calls.length, mockApi.applications.listForProperty.mock.calls.length]).toEqual([2, 2]);
    expect(textOf(view)).toContain('Theo Tenant');
    expect(textOf(view)).toContain('You approved an application, so this listing is leased and its status no longer changes.');
    expect(descendants(view).filter((element) => element.tagName === 'BUTTON' && textOf(element) === 'Delete listing')).toEqual([]);
  });

  it('offers a published listing no way to mark it leased by hand, and says how it is leased', async () => {
    const { view } = await open();

    expect(textOf(view)).toContain('Approving an application leases the listing and declines the other open applications.');
    expect(descendants(view).filter((element) => element.tagName === 'BUTTON' && textOf(element) === 'Mark as leased')).toEqual([]);
  });

  it('pauses the listing after saying what pausing does', async () => {
    mockApi.properties.update.mockResolvedValue(listing({ listing_status: 'paused', status: 'off_market' }));
    const { view } = await open();

    await click(getByName(view, 'button', 'Pause listing'));
    const [dialog] = dialogs(view);
    expect(textOf(dialog)).toContain('The listing leaves the public listings.');
    await click(getByName(dialog, 'button', 'Pause listing'));

    expect(mockApi.properties.update).toHaveBeenCalledWith('pr-1', { listing_status: 'paused' });
    expect(textOf(view)).toContain('Harbour flat is paused and off the public listings.');
    expect(descendants(view).filter((element) => textOf(element) === 'View public page')).toEqual([]);
    expect(getByName(view, 'button', 'Publish again')).toBeTruthy();
  });

  it('says why an unverified owner cannot publish the listing again', async () => {
    const message = 'Your account needs to be verified before you can publish listings. A document was rejected: replace it to send it for review again.';
    mockApi.properties.getMine.mockResolvedValue(listing({ listing_status: 'paused', status: 'off_market' }));
    mockApi.properties.update.mockRejectedValue(new ApiError(403, message, {
      code: 'verification_required', action: 'publish_listing', status: 'rejected', message,
      documents_href: '/owner/profile/verification',
    }));
    const { view } = await open();

    await click(getByName(view, 'button', 'Publish again'));
    const [dialog] = dialogs(view);
    await click(getByName(dialog, 'button', 'Publish again'));

    expect(mockApi.properties.update).toHaveBeenCalledWith('pr-1', { listing_status: 'published' });
    const alerts = descendants(dialog).filter((element) => element.getAttribute('role') === 'alert');
    expect(alerts.map(textOf)).toEqual([`A document needs replacing${message}Go to your documents`, '']);
    expect(getByName(dialog, 'a', 'Go to your documents').getAttribute('href')).toBe('/owner/profile/verification');
    expect(textOf(view)).not.toContain('is published: tenants can find it and apply.');
    expect(lowContrastText(dialog)).toEqual([]);
  });

  it('deletes the listing once confirmed and goes back to the list', async () => {
    mockApi.properties.remove.mockResolvedValue(undefined);
    const { view } = await open();

    await click(getByName(view, 'button', 'Delete listing'));
    await click(getByName(dialogs(view)[0], 'button', 'Delete listing'));

    expect(mockApi.properties.remove).toHaveBeenCalledWith('pr-1');
    expect(navigation.push).toHaveBeenCalledWith('/owner/properties');
  });

  it('says when nobody has applied yet', async () => {
    mockApi.applications.listForProperty.mockResolvedValue([]);
    const { view } = await open('/owner/properties/pr-1?tab=applications');

    expect(textOf(view)).toContain('No applications yet');
  });

  it('shows an applications error with a retry', async () => {
    mockApi.applications.listForProperty.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const { view } = await open('/owner/properties/pr-1?tab=applications');

    expect(textOf(view)).toContain('The service is temporarily unavailable.');
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Tanya Tenant');
  });

  it("shows not found for a listing that isn't the owner's", async () => {
    mockApi.properties.getMine.mockRejectedValue(new ApiError(404, 'Property not found'));
    const { view } = await open();

    expect(textOf(view)).toContain('Property not found');
    expect(getByName(view, 'a', '← Back to properties').getAttribute('href')).toBe('/owner/properties');
  });

  it("opens the inspections tab from the address and moves through all three tabs with the arrow keys", async () => {
    const { page, view } = await open('/owner/properties/pr-1?tab=inspections');

    expect(tab(view, /^Inspections/).getAttribute('aria-selected')).toBe('true');
    expect(inspections.owner).toHaveBeenCalledWith('pr-1');
    expect(inspections.records).toHaveBeenCalledWith('pr-1');
    expect(textOf(view)).toContain('Publish inspection times');
    expect(textOf(view)).toContain('Scheduled inspections');

    await act(async () => { fire(tab(view, /^Inspections/), 'keydown', { key: 'ArrowRight' }); });
    await land(page);
    expect(page.stack()).toEqual(['>/owner/properties/pr-1']);
    await act(async () => { fire(tab(view, /^Details/), 'keydown', { key: 'ArrowLeft' }); });
    await land(page);
    expect(page.stack()).toEqual(['>/owner/properties/pr-1?tab=inspections']);
    expect(tab(view, /^Inspections/).getAttribute('aria-selected')).toBe('true');
  });
});
