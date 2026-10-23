import { cleanup, click, descendants, dispatch, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { addDays, sydneyToday, type MyProfile, type MyProfileUpdate } from '@/app/lib/my-profile';
import type { OnboardingProgress } from '@/app/lib/onboarding';
import type { DocumentChecklist } from '@/app/lib/profile-documents';
import type { PublicProfileDetail } from '@/app/lib/public-profiles';
import { myProfile, profileServer } from '@/app/test-utils/my-profile';
import { alerts, button, field, group, heading, progressServer, tick } from '@/app/test-utils/onboarding';
import TenantOnboarding from './TenantOnboarding';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<MyProfile>>(),
  save: vi.fn<(patch: MyProfileUpdate) => Promise<MyProfile>>(),
  progress: vi.fn<() => Promise<OnboardingProgress>>(),
  remember: vi.fn<(step: string, completed?: boolean) => Promise<OnboardingProgress>>(),
  checklist: vi.fn<() => Promise<DocumentChecklist>>(),
  card: vi.fn<(id: string) => Promise<PublicProfileDetail>>(),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), search: '' }));

vi.mock('@/app/lib/my-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/my-profile')>()),
  getMyProfile: mocks.read,
  updateMyProfile: mocks.save,
}));
vi.mock('@/app/lib/onboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/onboarding')>()),
  onboardingApi: { get: mocks.progress, save: mocks.remember },
}));
vi.mock('@/app/lib/profile-documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/profile-documents')>()),
  documentsApi: { checklist: mocks.checklist },
}));
vi.mock('@/app/lib/public-profiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/public-profiles')>()),
  getPublicProfile: mocks.card,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: router.push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(router.search),
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const MEI = 'e1000000-0000-4000-8000-000000000001';
const MOVE_IN = addDays(sydneyToday(), 30);
const CHECKLIST: DocumentChecklist = {
  role: 'tenant',
  can_share: true,
  types: [{ type: 'PASSPORT', label: 'Passport', description: 'A current passport.', group: 'identity', group_label: 'Identity', repeatable: false, required: true, kinds: [] }],
  requirements: [{ key: 'photo_id', label: 'Photo ID', types: ['PASSPORT'], status: 'missing' }],
  requirements_met: false,
  account: { status: 'pending', rejection_reason: null, approved_at: null, account_rejected: false },
  documents: [],
};
const CARD: PublicProfileDetail = {
  id: MEI, role: 'tenant', role_label: 'Tenant', display_name: 'Mei L.', business_name: null, avatar_url: null,
  areas: ['Newtown'], about: null, verified: false, rating_avg: null, review_count: 0, budget_min: 450, budget_max: 700,
  move_in_month: null, categories: [], pricing_summary: null, service_area: null, provider_slug: null, reviews: [],
};

let profiles: ReturnType<typeof profileServer>;
let progress: ReturnType<typeof progressServer>;

function serve(profile: MyProfile, place: Partial<OnboardingProgress> = {}) {
  profiles = profileServer(profile);
  progress = progressServer('tenant', place);
  mocks.read.mockImplementation(profiles.read);
  mocks.save.mockImplementation(profiles.save);
  mocks.progress.mockImplementation(progress.get);
  mocks.remember.mockImplementation(progress.save);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  router.search = '';
  serve(myProfile({ id: MEI, phone: null }));
  mocks.checklist.mockResolvedValue(CHECKLIST);
  mocks.card.mockResolvedValue(CARD);
});
afterEach(cleanup);

function open(search = '') {
  router.search = search;
  return render(<TenantOnboarding />);
}

const continueOn = (view: FakeElement) => click(button(view, 'Continue'));
const lastSave = () => mocks.save.mock.calls.at(-1)?.[0];

/** Picks an option of a select, as a person does. */
async function choose(select: FakeElement, value: string) {
  select.value = value;
  await dispatch(select, 'change');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('a new tenant', () => {
  it('starts at the welcome step, and Get started opens the first step', async () => {
    const view = await open();
    expect(heading(view)).toBe('Create your renter profile');
    expect(textOf(view)).not.toContain('Step 1 of');

    await click(button(view, 'Get started'));

    expect(progress.saves).toEqual([{ step: 'personal', completed: false }]);
    expect(heading(view)).toBe('About you');
    expect(textOf(view)).toContain('Step 1 of 13');
    const bar = descendants(view).find((element) => element.getAttribute('role') === 'progressbar') as FakeElement;
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual(['1', '13']);
    expect(field(view, 'Full name').value).toBe('Mei Lin');
  });

  it('saves every step to the account on Continue, then lands on the dashboard', async () => {
    const view = await open();
    await click(button(view, 'Get started'));

    await typeInto(field(view, 'Phone'), '0400 111 222');
    await continueOn(view);
    expect(lastSave()).toEqual({ phone: '0400 111 222' });
    expect(heading(view)).toBe('Who is moving in');

    await typeInto(field(view, 'People moving in, including you'), '2');
    await click(button(view, '+ Add another person'));
    await typeInto(field(view, 'Full name'), 'Sam Lin');
    await typeInto(field(view, 'Relationship to you'), 'Partner');
    await continueOn(view);
    expect(lastSave()).toEqual({
      tenant: { household_size: 2, household: { members: [{ name: 'Sam Lin', age: null, relationship: 'Partner' }] } },
    });

    await typeInto(field(view, 'Suburb or postcode'), 'Newtown');
    await click(button(view, 'Add'));
    // Typed but not added: moving on keeps it.
    await typeInto(field(view, 'Suburb or postcode'), 'Glebe');
    await continueOn(view);
    expect(lastSave()).toEqual({ tenant: { preferred_locations: ['Newtown', 'Glebe'] } });

    await typeInto(field(view, 'Minimum ($/week)'), '450');
    await typeInto(field(view, 'Maximum ($/week)'), '700');
    await typeInto(field(view, 'Preferred move-in date'), MOVE_IN);
    await continueOn(view);
    expect(lastSave()).toEqual({ tenant: { budget_min: 450, budget_max: 700, move_in_date: MOVE_IN } });

    await tick(group(view, 'Property types'), 'Apartment');
    await choose(field(view, 'Bedrooms (at least)'), '2');
    await continueOn(view);
    expect(lastSave()).toEqual({ tenant: { rental_preferences: { property_types: ['apartment'], bedrooms_min: 2 } } });

    await tick(view, 'Working full-time');
    await typeInto(field(view, 'Employer or business'), 'Royal Prince Alfred');
    await continueOn(view);
    expect(lastSave()).toEqual({ tenant: { employment: { types: ['full_time'], employer: 'Royal Prince Alfred' } } });

    await tick(view, 'Reliable rent payments');
    await continueOn(view);
    expect(lastSave()).toEqual({ tenant: { qualities: { tags: ['reliable_rent'] } } });

    await typeInto(field(view, 'About you'), 'Quiet nurse who keeps a tidy home.');
    expect(textOf(view)).toContain('7 words');
    await continueOn(view);
    expect(lastSave()).toEqual({ tenant: { about_me: 'Quiet nurse who keeps a tidy home.' } });

    await click(button(view, '+ Add address'));
    await typeInto(field(view, 'Street address'), '12 King St');
    await typeInto(field(view, 'Suburb'), 'Newtown');
    await tick(view, 'This is my current address');
    await click(button(view, 'Add address'));
    expect(textOf(view)).toContain('12 King St, Newtown');
    await continueOn(view);
    expect(lastSave()).toEqual({ tenant: { rental_history: [expect.objectContaining({ address: '12 King St', suburb: 'Newtown', current: true })] } });

    const saved = mocks.save.mock.calls.length;
    expect(heading(view)).toBe('Verification documents');
    expect(textOf(view)).toContain('Passport');
    await continueOn(view);
    // Documents save as they upload, so moving on saves nothing more.
    expect(mocks.save.mock.calls.length).toBe(saved);

    await typeInto(field(view, 'Full name'), 'Ines Lin');
    await typeInto(field(view, 'Phone'), '0411 222 333');
    await continueOn(view);
    expect(lastSave()).toEqual({ tenant: { emergency_contact: { name: 'Ines Lin', phone: '0411 222 333' } } });

    expect(heading(view)).toBe('Preview your profile');
    expect(textOf(view)).toContain('Mei L.');
    expect(mocks.card).toHaveBeenCalledWith(MEI);
    await continueOn(view);

    expect(heading(view)).toBe('Share your profile');
    await click(button(view, 'Finish setup'));

    expect(progress.saves.map((entry) => entry.step)).toEqual([
      'personal', 'household', 'locations', 'budget', 'property', 'employment', 'qualities', 'about', 'history',
      'documents', 'emergency', 'preview', 'publish', 'publish',
    ]);
    expect(progress.saves.at(-1)).toEqual({ step: 'publish', completed: true });
    expect(progress.progress.completed_at).not.toBeNull();
    expect(router.push).toHaveBeenCalledWith('/tenant/dashboard');
    // Everything is on the account, in the shape the server keeps it.
    const tenant = profiles.profile.tenant!;
    expect(tenant.preferred_locations).toEqual(['Newtown', 'Glebe']);
    expect(tenant.employment.employer).toBe('Royal Prince Alfred');
    expect(tenant.rental_history).toHaveLength(1);
  });
});

describe('leaving and coming back', () => {
  it('saves the open step on Save & close, leaves for the dashboard, and resumes there in another browser', async () => {
    serve(myProfile({ id: MEI }), { step: 'budget' });
    let view = await open();
    expect(heading(view)).toBe('Rent and timing');
    expect(textOf(view)).toContain('Step 4 of 13');

    await typeInto(field(view, 'Maximum ($/week)'), '650');
    await click(button(view, 'Save & close'));

    expect(mocks.save).toHaveBeenCalledWith({ tenant: { budget_max: 650 } });
    expect(progress.saves).toEqual([{ step: 'budget', completed: false }]);
    expect(router.push).toHaveBeenCalledWith('/tenant/dashboard');

    // Another browser: its own storage, the same account.
    await cleanup();
    localStorage.clear();
    view = await open();
    expect(heading(view)).toBe('Rent and timing');
    expect(field(view, 'Maximum ($/week)').value).toBe('650');
  });

  it('keeps the page and says why when Save & close cannot save', async () => {
    serve(myProfile({ id: MEI }), { step: 'budget' });
    mocks.save.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await open();

    await typeInto(field(view, 'Maximum ($/week)'), '650');
    await click(button(view, 'Save & close'));

    expect(alerts(view)).toEqual(['The service is temporarily unavailable. Please try again.']);
    expect(router.push).not.toHaveBeenCalled();
    expect(progress.saves).toEqual([]);
    expect(field(view, 'Maximum ($/week)').value).toBe('650');
  });

  it('skips from the welcome step to the dashboard, noting that setup was left', async () => {
    const view = await open();
    await click(button(view, 'Skip for now'));

    expect(progress.saves).toEqual([{ step: 'welcome', completed: false }]);
    expect(router.push).toHaveBeenCalledWith('/tenant/dashboard');
  });

  it('still leaves when the skip cannot be noted', async () => {
    mocks.remember.mockRejectedValueOnce(new ApiError(0, 'Could not connect. Check your connection and try again.'));
    const view = await open();
    await click(button(view, 'Skip for now'));

    expect(router.push).toHaveBeenCalledWith('/tenant/dashboard');
  });

  it('saves the open step on Back before going back, without moving the saved place', async () => {
    serve(myProfile({ id: MEI }), { step: 'budget' });
    const view = await open();

    await typeInto(field(view, 'Minimum ($/week)'), '400');
    await click(button(view, 'Back'));

    expect(mocks.save).toHaveBeenCalledWith({ tenant: { budget_min: 400 } });
    expect(heading(view)).toBe('Where are you looking to live?');
    expect(progress.saves).toEqual([]);
  });

  it('opens a finished setup at the welcome step, to review the answers', async () => {
    serve(myProfile({ id: MEI }), { step: 'publish', completed_at: '2026-10-20T00:00:00Z' });
    const view = await open();
    expect(heading(view)).toBe('Your profile is set up');

    await click(button(view, 'Review my answers'));
    expect(heading(view)).toBe('About you');

    await cleanup();
    const again = await open();
    await click(button(again, 'Back to my dashboard'));
    // Finished: leaving notes nothing.
    expect(progress.saves).toEqual([{ step: 'personal', completed: false }]);
    expect(router.push).toHaveBeenCalledWith('/tenant/dashboard');
  });

  it('opens a step the wizard no longer has at the welcome step', async () => {
    serve(myProfile({ id: MEI }), { step: 'lifestyle' });
    expect(heading(await open())).toBe('Create your renter profile');
  });
});

describe('a task started before sign-up', () => {
  const task = '/tenant/properties/pr-1';

  it('resumes after the last step', async () => {
    serve(myProfile({ id: MEI }), { step: 'publish' });
    const view = await open(`next=${encodeURIComponent(task)}`);
    await click(button(view, 'Finish setup'));
    expect(router.push).toHaveBeenCalledWith(task);
  });

  it('resumes after Save & close, from any step', async () => {
    serve(myProfile({ id: MEI }), { step: 'employment' });
    const view = await open(`next=${encodeURIComponent(task)}`);
    await continueOn(view);
    await click(button(view, 'Save & close'));
    expect(progress.saves.map((entry) => entry.step)).toEqual(['qualities', 'qualities']);
    expect(router.push).toHaveBeenCalledWith(task);
  });

  it('resumes after a skip, and the welcome step says so', async () => {
    const view = await open(`next=${encodeURIComponent(task)}`);
    expect(textOf(view)).toContain('When you finish or leave setup, you go back to what you started.');
    await click(button(view, 'Skip for now'));
    expect(router.push).toHaveBeenCalledWith(task);
  });

  it('never leaves for another site', async () => {
    const view = await open(`next=${encodeURIComponent('//evil.example/tenant')}`);
    expect(textOf(view)).not.toContain('you go back to what you started');
    await click(button(view, 'Skip for now'));
    expect(router.push).toHaveBeenCalledWith('/tenant/dashboard');
  });
});

describe('checks before saving', () => {
  it('refuses a minimum budget above the maximum, saves nothing and points at the field', async () => {
    serve(myProfile({ id: MEI }), { step: 'budget' });
    const view = await open();

    await typeInto(field(view, 'Minimum ($/week)'), '800');
    await typeInto(field(view, 'Maximum ($/week)'), '600');
    await continueOn(view);

    expect(alerts(view)).toEqual(["The minimum budget can't be more than the maximum."]);
    expect(document.activeElement?.id).toBe('onboarding-budget-min');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(progress.saves).toEqual([]);
    expect(heading(view)).toBe('Rent and timing');
  });

  it('needs a name to continue', async () => {
    serve(myProfile({ id: MEI }), { step: 'personal' });
    const view = await open();

    await typeInto(field(view, 'Full name'), '  ');
    await continueOn(view);

    expect(alerts(view)).toEqual(['Enter your full name.']);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('shows what the server refused and stays on the step', async () => {
    serve(myProfile({ id: MEI }), { step: 'emergency' });
    mocks.save.mockRejectedValueOnce(new ApiError(422, 'Add a phone number or email for your emergency contact.'));
    const view = await open();

    await typeInto(field(view, 'Full name'), 'Ines Lin');
    await typeInto(field(view, 'Email'), 'ines@example.test');
    await continueOn(view);

    expect(alerts(view)).toEqual(['Add a phone number or email for your emergency contact.']);
    expect(heading(view)).toBe('Emergency contact');
    expect(progress.saves).toEqual([]);
  });

  it('gives the pressed button focus back when the step stays, as a disabled button drops it', async () => {
    serve(myProfile({ id: MEI }), { step: 'about' });
    mocks.remember.mockImplementationOnce(async () => {
      // A browser moves focus to the page once the pressed button is disabled.
      (document.activeElement as unknown as FakeElement).blur();
      throw new ApiError(503, 'The service is temporarily unavailable. Please try again.');
    });
    const view = await open();
    const go = button(view, 'Continue');
    go.focus();

    await continueOn(view);
    await new Promise((done) => setTimeout(done, 0));
    await settle();

    expect(heading(view)).toBe('Introduce yourself');
    expect(document.activeElement).toBe(go);
  });

  it('leaves focus on the next step\'s heading when the step moves on', async () => {
    serve(myProfile({ id: MEI }), { step: 'about' });
    const view = await open();
    button(view, 'Continue').focus();

    await continueOn(view);
    await new Promise((done) => setTimeout(done, 0));
    await settle();

    expect(heading(view)).toBe('Rental history');
    expect(textOf(document.activeElement as unknown as FakeElement)).toBe('Rental history');
  });

  it('moves on, telling the member once, when the server cannot keep their place', async () => {
    serve(myProfile({ id: MEI }));
    // Another app keeps users.metadata.onboarding in a shape the server never overwrites.
    mocks.remember.mockRejectedValue(new ApiError(409, 'Your setup progress was saved by another app in a form the website cannot change.'));
    const view = await open();

    await click(button(view, 'Get started'));
    expect(heading(view)).toBe('About you');
    await typeInto(field(view, 'Suburb you live in'), 'Newtown');
    await continueOn(view);

    expect(heading(view)).toBe('Who is moving in');
    expect(profiles.profile.location).toBe('Newtown');
    expect(alerts(view)).toEqual([]);
    const notices = descendants(view).filter((element) => element.getAttribute('role') === 'status'
      && textOf(element).includes("this setup can't remember the step you reached"));
    expect(notices).toHaveLength(1);
  });

  it('stays when the place cannot be saved, and a second Continue finishes the move', async () => {
    serve(myProfile({ id: MEI }), { step: 'about' });
    mocks.remember.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await open();

    await typeInto(field(view, 'About you'), 'Hello');
    await continueOn(view);
    expect(alerts(view)).toEqual(['The service is temporarily unavailable. Please try again.']);
    expect(heading(view)).toBe('Introduce yourself');

    await continueOn(view);
    expect(heading(view)).toBe('Rental history');
    expect(profiles.profile.tenant?.about_me).toBe('Hello');
  });
});

describe('the page', () => {
  it('shows a loading state, then offers a retry when setup cannot load', async () => {
    const reading = deferred<OnboardingProgress>();
    mocks.progress.mockReturnValueOnce(reading.promise);
    const view = await open();
    expect(textOf(view)).toContain('Loading your setup…');

    await act(async () => reading.resolve({ role: 'tenant', step: null, completed_at: null }));
    await settle();
    expect(heading(view)).toBe('Create your renter profile');

    await cleanup();
    mocks.read.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const failed = await open();
    expect(textOf(failed)).toContain('Your setup could not be loaded');
    await click(button(failed, 'Try again'));
    expect(heading(failed)).toBe('Create your renter profile');
  });

  it('sends a landlord to their own setup', async () => {
    serve(myProfile({ id: MEI }, { landlord: true }));
    progress = progressServer('landlord');
    mocks.progress.mockImplementation(progress.get);
    const view = await open();

    expect(heading(view)).toBe('This setup is for tenant accounts');
    expect(descendants(view).find((element) => element.tagName === 'A' && textOf(element) === 'Open my setup')?.getAttribute('href'))
      .toBe('/owner/onboarding');
  });

  it('labels a seeded sample account', async () => {
    serve(myProfile({ id: 'b0000000-0000-4000-8000-000000000001' }));
    const view = await open();
    expect(textOf(view)).toContain('Sample account');
  });

  it('keeps every text readable', async () => {
    const view = await open();
    expect(lowContrastText(view)).toEqual([]);
    await click(button(view, 'Get started'));
    expect(lowContrastText(view)).toEqual([]);
  });
});
