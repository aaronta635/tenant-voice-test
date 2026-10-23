import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { sydneyToday, type MyProfile, type MyProfileUpdate } from '@/app/lib/my-profile';
import { getTenantScreen } from '@/app/lib/tenant-data';
import { emptyTenant, myProfile, profileServer } from '@/app/test-utils/my-profile';
import TenantFormScreens from './TenantFormScreens';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<MyProfile>>(),
  save: vi.fn<(patch: MyProfileUpdate) => Promise<MyProfile>>(),
  sideRead: vi.fn<() => Promise<MyProfile>>(),
}));
vi.mock('@/app/lib/my-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/my-profile')>()),
  getMyProfile: mocks.read,
  updateMyProfile: mocks.save,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  // The side panel's own reads.
  api: { profiles: { me: () => mocks.sideRead() }, notifications: { list: async () => [] } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const LEGACY_KEY = 'tv_tenant_profile_extras';
let server: ReturnType<typeof profileServer>;

function serve(profile: MyProfile) {
  server = profileServer(profile);
  mocks.read.mockImplementation(server.read);
  mocks.save.mockImplementation(server.save);
  mocks.sideRead.mockImplementation(server.read);
}

beforeEach(() => {
  // Also drops a once-only answer a test left unused.
  vi.resetAllMocks();
  localStorage.clear();
  serve(myProfile());
});
afterEach(cleanup);

function screen(slug: string) {
  const found = getTenantScreen(slug);
  if (!found) throw new Error(`No tenant screen ${slug}`);
  return found;
}

const openScreen = (slug: string) => render(<TenantFormScreens screen={screen(slug)} />);

/** The control a label names: through its for, or the one inside it. */
function field(view: FakeElement, label: string): FakeElement {
  const labels = descendants(view).filter((element) => element.tagName === 'LABEL' && textOf(element) === label);
  if (labels.length !== 1) throw new Error(`Expected one label "${label}", found ${labels.length}`);
  const id = labels[0].getAttribute('for');
  const control = id
    ? descendants(view).find((element) => element.id === id)
    : descendants(labels[0]).find((element) => element.tagName === 'INPUT');
  if (!control) throw new Error(`No control for "${label}"`);
  return control;
}

async function tick(view: FakeElement, label: string) {
  const box = field(view, label);
  box.checked = !box.checked;
  await click(box);
}

const submit = (view: FakeElement, index = 0) =>
  dispatch(descendants(view).filter((element) => element.tagName === 'FORM')[index], 'submit');
const alerts = (view: FakeElement) =>
  descendants(view).filter((element) => element.getAttribute('role') === 'alert').map(textOf).filter(Boolean);
const statuses = (view: FakeElement) =>
  descendants(view).filter((element) => element.getAttribute('role') === 'status').map(textOf).filter(Boolean);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('the tenant profile screens', () => {
  it('show a loading state, then the details saved to the account', async () => {
    const reading = deferred<MyProfile>();
    mocks.read.mockReturnValueOnce(reading.promise);
    const view = await openScreen('financial-information');
    expect(statuses(view)).toContain('Loading your details…');

    await act(async () => reading.resolve(myProfile({
      tenant: { ...emptyTenant(), employment: { types: ['student'], employer: 'Campus Cafe', job_title: null, annual_income: 18000, notes: null } },
    })));
    await settle();

    expect(field(view, 'Employer or business (if any)').value).toBe('Campus Cafe');
    expect(field(view, 'Annual income').value).toBe('18000');
    expect(field(view, 'Student').checked).toBe(true);
  });

  it('offer a retry when the profile cannot be loaded', async () => {
    mocks.read.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await openScreen('contact-details');

    expect(textOf(view)).toContain('Your details could not be loaded');
    expect(textOf(view)).toContain('The service is temporarily unavailable. Please try again.');
    await click(getByName(view, 'button', 'Try again'));

    expect(field(view, 'Suburb').value).toBe('Newtown');
  });

  it('save to the account, so the values come back in another browser', async () => {
    let view = await openScreen('financial-information');
    await tick(view, 'Working full-time');
    await typeInto(field(view, 'Employer or business'), '  Royal Prince Alfred ');
    await typeInto(field(view, 'Job title'), 'Nurse');
    await typeInto(field(view, 'Annual income'), '92000');
    await submit(view);

    // Only what changed: the notes were empty and still are.
    expect(mocks.save).toHaveBeenCalledWith({
      tenant: { employment: { types: ['full_time'], employer: 'Royal Prince Alfred', job_title: 'Nurse', annual_income: 92000 } },
    });
    expect(statuses(view)).toContain('Saved to your account.');
    // Nothing of it stays in this browser.
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

    // Another browser: its own storage, the same account.
    await cleanup();
    localStorage.clear();
    view = await openScreen('financial-information');
    expect(field(view, 'Employer or business').value).toBe('Royal Prince Alfred');
    expect(field(view, 'Job title').value).toBe('Nurse');
    expect(field(view, 'Annual income').value).toBe('92000');
    expect(field(view, 'Working full-time').checked).toBe(true);
  });

  it('show that a save is under way, and its error, keeping what was typed', async () => {
    const saving = deferred<MyProfile>();
    mocks.save.mockReturnValueOnce(saving.promise);
    const view = await openScreen('personal-information');
    await typeInto(field(view, 'Full name'), 'Mei Lin-Chen');
    await submit(view);

    const button = getByName(view, 'button', 'Saving…');
    expect(button.hasAttribute('disabled')).toBe(true);
    await act(async () => saving.resolve(myProfile({ full_name: 'Mei Lin-Chen' })));
    await settle();
    expect(getByName(view, 'button', 'Save changes').hasAttribute('disabled')).toBe(false);
    expect(statuses(view)).toContain('Saved to your account.');

    mocks.save.mockRejectedValueOnce(new ApiError(422, 'full name: String should have at most 120 characters'));
    await typeInto(field(view, 'Full name'), 'x'.repeat(10));
    expect(statuses(view)).not.toContain('Saved to your account.');
    await submit(view);
    expect(alerts(view)).toEqual(['full name: String should have at most 120 characters']);
    expect(field(view, 'Full name').value).toBe('x'.repeat(10));
  });

  it('check what spans fields before saving, as the server does', async () => {
    const view = await openScreen('rental-preferences');
    await typeInto(field(view, 'Minimum weekly budget ($)'), '800');
    await typeInto(field(view, 'Maximum weekly budget ($)'), '700');
    await submit(view, 0);

    expect(alerts(view)).toEqual(["The minimum budget can't be more than the maximum."]);
    expect(mocks.save).not.toHaveBeenCalled();

    const contact = await openScreen('contact-details');
    await typeInto(field(contact, 'Their phone'), '0411 222 333');
    await submit(contact);
    expect(alerts(contact)).toContain("Add your emergency contact's name.");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('send only what changed, so a value stored before today\'s checks never blocks a save', async () => {
    // A move-in date over a year old, and another app's phone format.
    serve(myProfile({ phone: 'call me', tenant: { ...emptyTenant(), move_in_date: '2024-01-15', budget_max: 600 } }));
    const preferences = await openScreen('rental-preferences');
    await typeInto(field(preferences, 'Maximum weekly budget ($)'), '650');
    await submit(preferences, 0);

    expect(alerts(preferences)).toEqual([]);
    expect(mocks.save).toHaveBeenLastCalledWith({ tenant: { budget_max: 650 } });

    const personal = await openScreen('personal-information');
    await typeInto(field(personal, 'About me'), 'Quiet nurse.');
    await submit(personal);
    expect(alerts(personal)).toEqual([]);
    expect(mocks.save).toHaveBeenLastCalledWith({ tenant: { about_me: 'Quiet nurse.' } });
  });

  it('save nothing when nothing changed', async () => {
    const view = await openScreen('financial-information');
    await submit(view);

    expect(mocks.save).not.toHaveBeenCalled();
    expect(statuses(view)).toContain('No changes to save.');
  });

  it('refresh the side panel after a save, since its completion may have moved', async () => {
    let score = 9;
    mocks.sideRead.mockImplementation(async () => ({ ...server.profile, completion: { ...server.profile.completion!, score } }));
    const view = await openScreen('rental-preferences');
    expect(textOf(view)).toContain('9% Complete');

    score = 18;
    await typeInto(field(view, 'Preferred move-in date'), sydneyToday());
    await submit(view, 0);

    expect(textOf(view)).toContain('18% Complete');
  });

  it('save rental preferences and the household as two forms', async () => {
    const view = await openScreen('rental-preferences');
    await typeInto(field(view, 'Maximum weekly budget ($)'), '700');
    await typeInto(field(view, 'Preferred suburbs'), 'Newtown, Glebe, newtown');
    await tick(view, 'Townhouse');
    await typeInto(field(view, 'Bedrooms (at least)'), '2');
    await submit(view, 0);

    expect(mocks.save).toHaveBeenLastCalledWith({
      tenant: {
        budget_max: 700, preferred_locations: ['Newtown', 'Glebe'],
        rental_preferences: { property_types: ['townhouse'], bedrooms_min: 2 },
      },
    });

    await typeInto(field(view, 'People in the household'), '2');
    await click(getByName(view, 'button', 'Add a person'));
    await typeInto(field(view, 'Person 1: name'), 'Sam Lin');
    await typeInto(field(view, 'Relationship to you'), 'Partner');
    await submit(view, 1);

    expect(mocks.save).toHaveBeenLastCalledWith({
      tenant: { household_size: 2, household: { members: [{ name: 'Sam Lin', age: null, relationship: 'Partner' }] } },
    });
    expect(server.profile.tenant?.household.members).toEqual([{ name: 'Sam Lin', age: null, relationship: 'Partner' }]);
  });

  it('add and remove rental history addresses on the account', async () => {
    const view = await openScreen('address-history');
    expect(textOf(view)).toContain('No previous addresses yet.');

    await typeInto(field(view, 'Street address'), '12/55 Martin Place');
    await typeInto(field(view, 'Suburb'), 'Sydney');
    await typeInto(field(view, 'Lease start'), '2021-02-01');
    await tick(view, 'I live here now');
    await submit(view);

    expect(mocks.save).toHaveBeenLastCalledWith({ tenant: { rental_history: [expect.objectContaining({
      address: '12/55 Martin Place', suburb: 'Sydney', start_date: '2021-02-01', end_date: null, current: true,
    })] } });
    expect(textOf(view)).toContain('12/55 Martin Place, Sydney');
    expect(textOf(view)).toContain('Feb 2021 to now');
    expect(statuses(view)).toContain('Address added to your rental history.');
    expect(field(view, 'Street address').value).toBe('');

    await click(getByName(view, 'button', 'Remove 12/55 Martin Place'));
    expect(mocks.save).toHaveBeenLastCalledWith({ tenant: { rental_history: [] } });
    expect(textOf(view)).toContain('No previous addresses yet.');
  });

  it('save the notification and privacy switches to the account', async () => {
    const view = await openScreen('settings');
    await tick(view, 'Property matchesListings that fit your rental preferences.');
    await tick(view, 'Show my public profileVisitors and members can find your card: first name, suburbs, budget and about line.');
    await submit(view);

    expect(mocks.save).toHaveBeenCalledWith({
      settings: {
        notification_preferences: {
          push_enabled: true, matches: false, application: true, message: true, repairs: true, property: true,
          booking: true, review: true, profile_updates: true,
        },
        privacy: {
          public_profile: false, discoverable: true, show_availability: true, allow_messages: true, show_contact: false,
          share_score: true,
        },
      },
    });
    expect(statuses(view)).toContain('Settings saved to your account.');
    expect(server.profile.settings.privacy.public_profile).toBe(false);
  });

  it('save tenant qualities to the account', async () => {
    const view = await openScreen('tenant-qualities');
    await tick(view, 'Clear communication');
    await typeInto(field(view, 'Anything else owners should know'), 'Happy to share references.');
    await submit(view);

    expect(mocks.save).toHaveBeenCalledWith({
      tenant: { qualities: { tags: ['clear_communication'], notes: 'Happy to share references.' } },
    });
  });

  it.each(['personal-information', 'contact-details', 'financial-information', 'rental-preferences', 'address-history',
    'tenant-qualities', 'settings'])('keep the %s screen at AA contrast, also under the pointer', async (slug) => {
    const view = await openScreen(slug);

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

describe('details an older build kept in this browser', () => {
  const OLDER = { emergency_name: 'Ines Lin', emergency_phone: '0411 222 333', budget_max: '700', passport_name: 'passport.jpg' };

  it('are offered once to an account without details, with their values, and saved to it', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(OLDER));
    let view = await openScreen('rental-preferences');

    expect(textOf(view)).toContain('Rental preferences: up to $700 a week');
    expect(textOf(view)).toContain('Save them to your account only if they are yours.');
    expect(field(view, 'Maximum weekly budget ($)').value).toBe('');
    await click(getByName(view, 'button', 'Save to my account'));

    expect(mocks.save).toHaveBeenCalledWith({ tenant: { budget_max: 700 } });
    expect(statuses(view)).toContain('The details from this browser are now saved to your account.');
    // The form starts again from the saved details.
    expect(field(view, 'Maximum weekly budget ($)').value).toBe('700');
    // Only the ID screen's note of the chosen file is left.
    expect(JSON.parse(localStorage.getItem(LEGACY_KEY)!)).toEqual({ passport_name: 'passport.jpg' });

    await cleanup();
    view = await openScreen('contact-details');
    expect(textOf(view)).not.toContain('Details saved in this browser');
  });

  it('never save a private detail: they are named, and enter again by hand', async () => {
    // Anyone may have used this browser: an emergency contact is not offered for one-click saving.
    localStorage.setItem(LEGACY_KEY, JSON.stringify(OLDER));
    const view = await openScreen('contact-details');

    const offer = descendants(view).find((element) => element.getAttribute('aria-labelledby') === 'legacy-profile-offer')!;
    expect(textOf(offer)).toContain('It also kept an emergency contact.');
    expect(textOf(offer)).not.toContain('your emergency contact');
    await click(getByName(view, 'button', 'Save to my account'));

    expect(mocks.save).toHaveBeenCalledWith({ tenant: { budget_max: 700 } });
    expect(field(view, 'Their full name').value).toBe('');
    expect(JSON.parse(localStorage.getItem(LEGACY_KEY)!)).toEqual({ passport_name: 'passport.jpg' });
  });

  it('offer only a removal when all that is left is private', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ emergency_name: 'Ines Lin', emergency_phone: '0411 222 333' }));
    const view = await openScreen('contact-details');

    expect(textOf(view)).toContain('It also kept an emergency contact.');
    expect(descendants(view).some((element) => element.tagName === 'BUTTON' && textOf(element) === 'Save to my account')).toBe(false);
    await click(getByName(view, 'button', 'Remove them'));

    expect(mocks.save).not.toHaveBeenCalled();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('are removed without a save when declined', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(OLDER));
    const view = await openScreen('financial-information');
    await click(getByName(view, 'button', 'Remove them'));

    expect(mocks.save).not.toHaveBeenCalled();
    expect(statuses(view)).toContain('The details saved in this browser were removed.');
    expect(JSON.parse(localStorage.getItem(LEGACY_KEY)!)).toEqual({ passport_name: 'passport.jpg' });
  });

  it('stay in this browser when the save fails, with the reason', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(OLDER));
    mocks.save.mockRejectedValueOnce(new ApiError(0, 'Could not connect. Check your connection and try again.'));
    const view = await openScreen('settings');
    await click(getByName(view, 'button', 'Save to my account'));

    expect(alerts(view)).toEqual(['Could not connect. Check your connection and try again.']);
    expect(getByName(view, 'button', 'Save to my account')).toBeDefined();
    expect(JSON.parse(localStorage.getItem(LEGACY_KEY)!)).toMatchObject({ budget_max: '700' });
  });

  it('give way to the details the account already has', async () => {
    serve(myProfile({ tenant: { ...emptyTenant(), budget_max: 650 } }));
    localStorage.setItem(LEGACY_KEY, JSON.stringify(OLDER));
    const view = await openScreen('rental-preferences');

    expect(textOf(view)).not.toContain('Details saved in this browser');
    expect(field(view, 'Maximum weekly budget ($)').value).toBe('650');
    expect(JSON.parse(localStorage.getItem(LEGACY_KEY)!)).toEqual({ passport_name: 'passport.jpg' });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
