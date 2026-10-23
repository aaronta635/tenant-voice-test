import { cleanup, click, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { MyProfile, MyProfileUpdate } from '@/app/lib/my-profile';
import type { OnboardingProgress } from '@/app/lib/onboarding';
import type { DocumentChecklist, ProfileDocument, RequirementStatus } from '@/app/lib/profile-documents';
import type { PublicProfileDetail } from '@/app/lib/public-profiles';
import { myProfile, profileServer } from '@/app/test-utils/my-profile';
import { alerts, button, field, heading, progressServer, tick } from '@/app/test-utils/onboarding';
import LandlordOnboarding from './LandlordOnboarding';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<MyProfile>>(),
  save: vi.fn<(patch: MyProfileUpdate) => Promise<MyProfile>>(),
  progress: vi.fn<() => Promise<OnboardingProgress>>(),
  remember: vi.fn<(step: string, completed?: boolean) => Promise<OnboardingProgress>>(),
  checklist: vi.fn<() => Promise<DocumentChecklist>>(),
  upload: vi.fn<(type: string, file: File) => Promise<ProfileDocument>>(),
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
  documentsApi: { checklist: mocks.checklist, upload: mocks.upload },
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

const LEO = 'e2000000-0000-4000-8000-000000000001';
const LISTING_FORM = '/owner/properties/create';

let profiles: ReturnType<typeof profileServer>;
let progress: ReturnType<typeof progressServer>;
let uploaded: ProfileDocument[];

function checklist(): DocumentChecklist {
  const status = (type: string): RequirementStatus => (uploaded.some((document) => document.document_type === type) ? 'pending' : 'missing');
  return {
    role: 'landlord',
    can_share: false,
    types: [
      { type: 'DRIVERS_LICENCE', label: 'Driver licence', description: 'A current licence.', group: 'identity', group_label: 'Identity', repeatable: false, required: true, kinds: [] },
      { type: 'PROOF_OF_PROPERTY_OWNERSHIP', label: 'Proof of ownership', description: 'A rates notice.', group: 'property', group_label: 'Property', repeatable: false, required: true, kinds: [] },
    ],
    requirements: [
      { key: 'photo_id', label: 'Photo ID', types: ['DRIVERS_LICENCE'], status: status('DRIVERS_LICENCE') },
      { key: 'property_authority', label: 'Proof of ownership or management authority', types: ['PROOF_OF_PROPERTY_OWNERSHIP'], status: status('PROOF_OF_PROPERTY_OWNERSHIP') },
    ],
    requirements_met: false,
    account: { status: 'pending', rejection_reason: null, approved_at: null, account_rejected: false },
    documents: uploaded,
  };
}

/** The landlord's saved place in setup: the step to resume at, or none yet. */
function resumeAt(step: string | null) {
  progress = progressServer('landlord', { step });
  mocks.progress.mockImplementation(progress.get);
  mocks.remember.mockImplementation(progress.save);
}

function card(profile: MyProfile): PublicProfileDetail {
  return {
    id: profile.id, role: 'landlord', role_label: 'Landlord', display_name: profile.full_name,
    business_name: profile.landlord?.agency_name ?? null, avatar_url: null, areas: ['Marrickville, NSW'],
    about: profile.landlord?.bio ?? null, verified: false, rating_avg: null, review_count: 0, budget_min: null,
    budget_max: null, move_in_month: null, categories: [], pricing_summary: null, service_area: null,
    provider_slug: null, reviews: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  router.search = '';
  uploaded = [];
  profiles = profileServer(myProfile({ id: LEO, full_name: 'Leo Landlord', phone: null }, { landlord: true }));
  mocks.read.mockImplementation(profiles.read);
  mocks.save.mockImplementation(profiles.save);
  resumeAt(null);
  mocks.checklist.mockImplementation(async () => checklist());
  mocks.upload.mockImplementation(async (type, file) => {
    const document: ProfileDocument = {
      id: `doc-${uploaded.length + 1}`, document_type: type, label: type, status: 'pending', rejection_reason: null,
      file_name: file.name, has_file: true, can_open: true, visibility: 'private', kind: null,
      submitted_at: '2026-10-23T00:00:00Z', verified_at: null,
    };
    uploaded.push(document);
    return document;
  });
  mocks.card.mockImplementation(async () => card(profiles.profile));
});
afterEach(cleanup);

function open(search = '') {
  router.search = search;
  return render(<LandlordOnboarding />);
}

const continueOn = (view: FakeElement) => click(button(view, 'Continue'));
const lastSave = () => mocks.save.mock.calls.at(-1)?.[0];

async function attach(view: FakeElement, type: string, name: string) {
  const input = getByName(view, 'input', `File for ${type}`);
  input.files = [new File([new Uint8Array(10)], name, { type: 'application/pdf' })];
  await dispatch(input, 'change');
}

describe('a new landlord', () => {
  it('goes through every step, saving each one, and lands on the landlord dashboard', async () => {
    const view = await open();
    expect(heading(view)).toBe('Set up your landlord profile');
    await click(button(view, 'Get started'));
    expect(textOf(view)).toContain('Step 1 of 6');

    await typeInto(field(view, 'Phone'), '0400 333 444');
    await typeInto(field(view, 'Suburb you live in'), 'Marrickville');
    await continueOn(view);
    expect(lastSave()).toEqual({ phone: '0400 333 444', location: 'Marrickville' });

    expect(heading(view)).toBe('Your rental business');
    await typeInto(field(view, 'Agency or business name (optional)'), 'Harbour Homes');
    await typeInto(field(view, 'Properties you rent out'), '3');
    await continueOn(view);
    expect(lastSave()).toEqual({ landlord: { agency_name: 'Harbour Homes', portfolio_size: 3 } });

    await typeInto(field(view, 'About you and your rentals'), 'Family-run rentals in the inner west.');
    await continueOn(view);
    expect(lastSave()).toEqual({ landlord: { bio: 'Family-run rentals in the inner west.' } });

    expect(heading(view)).toBe('Verification documents');
    await attach(view, 'Driver licence', 'Licence.pdf');
    expect(mocks.upload).toHaveBeenCalledWith('DRIVERS_LICENCE', expect.any(File), expect.anything());
    const saves = mocks.save.mock.calls.length;
    await continueOn(view);
    expect(mocks.save.mock.calls.length).toBe(saves);

    expect(heading(view)).toBe('Preview your profile');
    expect(textOf(view)).toContain('Harbour Homes');
    // Personal details and the photo ID are in; the ownership proof is not.
    expect(textOf(view)).toContain('2 of 3 required items done');
    expect(textOf(view)).toContain('Proof of ownership or management authority');
    await continueOn(view);

    expect(heading(view)).toBe('Share your profile');
    await tick(view, 'Show my profile in profile search');
    expect(textOf(view)).toContain('You stay out of profile search');
    await click(button(view, 'Finish setup'));

    expect(lastSave()).toEqual({ settings: { privacy: { public_profile: false } } });
    expect(progress.saves.map((entry) => entry.step)).toEqual(['personal', 'business', 'about', 'documents', 'preview', 'publish', 'publish']);
    expect(progress.progress.completed_at).not.toBeNull();
    expect(router.push).toHaveBeenCalledWith('/owner');
  });

  it('refuses a licence number the server would not take', async () => {
    resumeAt('business');
    const view = await open();

    await typeInto(field(view, 'Licence number (optional)'), 'NSW#1234');
    await continueOn(view);

    expect(alerts(view)).toEqual(['Use only letters, numbers, spaces, dots, slashes and dashes in the licence number.']);
    expect(document.activeElement?.id).toBe('onboarding-licence');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('says so in the preview when the profile is hidden from search', async () => {
    resumeAt('preview');
    mocks.card.mockRejectedValue(new ApiError(404, 'Profile not found'));
    const view = await open();

    expect(textOf(view)).toContain('Your profile is hidden from profile search');
  });
});

describe('listing a property started before sign-up', () => {
  it('resumes the listing form after the last step', async () => {
    resumeAt('publish');
    const view = await open(`next=${encodeURIComponent(LISTING_FORM)}`);

    await click(button(view, 'Finish setup'));

    expect(progress.saves).toEqual([{ step: 'publish', completed: true }]);
    expect(router.push).toHaveBeenCalledWith(LISTING_FORM);
  });

  it('resumes the listing form when setup is skipped or closed', async () => {
    let view = await open(`next=${encodeURIComponent(LISTING_FORM)}`);
    await click(button(view, 'Skip for now'));
    expect(router.push).toHaveBeenLastCalledWith(LISTING_FORM);

    await cleanup();
    view = await open(`next=${encodeURIComponent(LISTING_FORM)}`);
    await click(button(view, 'Get started'));
    await click(button(view, 'Save & close'));
    expect(progress.saves.at(-1)).toEqual({ step: 'personal', completed: false });
    expect(router.push).toHaveBeenLastCalledWith(LISTING_FORM);
  });
});

it('keeps every text of the landlord steps readable', async () => {
  const view = await open();
  expect(lowContrastText(view)).toEqual([]);
  await click(button(view, 'Get started'));
  await continueOn(view);
  expect(lowContrastText(view)).toEqual([]);
});
