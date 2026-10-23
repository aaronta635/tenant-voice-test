import { cleanup, descendants, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyProfile, ProfileCompletion } from '@/app/lib/my-profile';
import type { OnboardingProgress } from '@/app/lib/onboarding';
import { getTenantScreen } from '@/app/lib/tenant-data';
import { myProfile } from '@/app/test-utils/my-profile';
import { ProfileCompletionScreen } from '@/app/components/tenant/TenantFormScreens';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<MyProfile>>(),
  progress: vi.fn<() => Promise<OnboardingProgress>>(),
}));
vi.mock('@/app/lib/my-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/my-profile')>()),
  getMyProfile: mocks.read,
}));
vi.mock('@/app/lib/onboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/onboarding')>()),
  onboardingApi: { get: mocks.progress, save: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const MEI = 'e1000000-0000-4000-8000-000000000001';

/** A completion as services/profile_completion.py sends it, with some of its rows. */
const COMPLETION: ProfileCompletion = {
  score: 53, status: 'almost_ready', required_done: 6, required_total: 8, boosters_done: 1, boosters_total: 8,
  items: [
    { key: 'personal_details', label: 'Personal details', description: 'Your full name and a phone number.', kind: 'required', done: true, available: true },
    { key: 'employment', label: 'Employment', description: 'Your employment type.', kind: 'required', done: true, available: true },
    { key: 'secondary_id', label: 'Secondary ID document', description: 'A second identity document.', kind: 'required', done: false, available: true },
    { key: 'payslips', label: 'Payslips', description: 'Recent payslips.', kind: 'booster', done: true, available: true },
    { key: 'availability', label: 'Availability', description: 'The date you can move in.', kind: 'required', done: false, available: true },
    { key: 'owner_reference', label: 'Owner or agent reference', description: 'A scorecard.', kind: 'booster', done: false, available: false },
    { key: 'pets_policy', label: 'Pet references', description: 'A row the server adds later.', kind: 'booster', done: false, available: true },
  ],
  missing: ['secondary_id', 'availability', 'pets_policy'],
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.read.mockResolvedValue(myProfile({ id: MEI, completion: COMPLETION }));
  mocks.progress.mockResolvedValue({ role: 'tenant', step: null, completed_at: null });
});
afterEach(cleanup);

const openPage = () => render(<ProfileCompletionScreen screen={getTenantScreen('profile-completion')!} />);

function section(view: FakeElement, title: string) {
  return descendants(view).find((element) => element.tagName === 'SECTION'
    && descendants(element).some((child) => child.tagName === 'H2' && textOf(child) === title)) as FakeElement;
}

describe('the tenant profile completion page', () => {
  it('shows the score and rows the server worked out, without working anything out itself', async () => {
    const view = await openPage();

    expect(textOf(view)).toContain('53%');
    expect(textOf(view)).toContain('Almost ready');
    const bars = descendants(view).filter((element) => element.getAttribute('role') === 'progressbar');
    expect(bars.map((bar) => [bar.getAttribute('aria-label'), bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]))
      .toEqual([['Core requirements', '6', '8'], ['Trust score boosters', '1', '8']]);
    expect(textOf(view)).toContain('Complete every required section to make your profile ready to share with owners.');
  });

  it('groups the rows as the reference does, each linking to where to complete it', async () => {
    const view = await openPage();

    expect(textOf(section(view, 'Personal details'))).toContain('2 of 2 done');
    expect(textOf(section(view, 'Verification documents'))).toContain('1 of 2 done');
    expect(textOf(section(view, 'Rental readiness'))).toContain('0 of 2 done');
    // A row the page does not know yet still shows.
    expect(textOf(section(view, 'Other'))).toContain('Pet references');

    expect(getByName(view, 'a', 'Review Personal details').getAttribute('href')).toBe('/tenant/personal-information');
    expect(getByName(view, 'a', 'Complete Secondary ID document').getAttribute('href')).toBe('/tenant/id-verification');
    expect(getByName(view, 'a', 'Complete Availability').getAttribute('href')).toBe('/tenant/rental-preferences');
    expect(textOf(section(view, 'Personal details'))).toContain('Required');
    expect(textOf(section(view, 'Verification documents'))).toContain('Boosts profile');

    // A row the server cannot count yet has no link.
    expect(textOf(section(view, 'Rental readiness'))).toContain('Not available yet');
    expect(descendants(view).some((element) => element.tagName === 'A' && textOf(element).includes('Owner or agent reference'))).toBe(false);
    expect(textOf(view)).toContain('Owner scorecards do not count towards your completion yet');
  });

  it('links the public profile, or says it is hidden', async () => {
    let view = await openPage();
    expect(getByName(view, 'a', 'Preview public profile').getAttribute('href')).toBe(`/public/${MEI}`);

    await cleanup();
    const hidden = myProfile({ id: MEI, completion: COMPLETION });
    hidden.settings = { ...hidden.settings, privacy: { public_profile: false, share_score: true } };
    mocks.read.mockResolvedValue(hidden);
    view = await openPage();
    expect(textOf(view)).toContain('Your profile is hidden from profile search.');
    expect(getByName(view, 'a', 'Change this in your settings').getAttribute('href')).toBe('/tenant/settings');
  });

  it('offers to start setup, then to finish it, and says nothing once it is done', async () => {
    let view = await openPage();
    expect(textOf(view)).toContain('Set up your profile step by step');
    expect(getByName(view, 'a', 'Start setup').getAttribute('href')).toBe('/tenant/onboarding');

    await cleanup();
    mocks.progress.mockResolvedValue({ role: 'tenant', step: 'budget', completed_at: null });
    view = await openPage();
    expect(textOf(view)).toContain('Finish setting up your profile');
    expect(textOf(view)).toContain('Pick up at "Rent and timing".');
    expect(getByName(view, 'a', 'Finish setup').getAttribute('href')).toBe('/tenant/onboarding');

    await cleanup();
    mocks.progress.mockResolvedValue({ role: 'tenant', step: 'publish', completed_at: '2026-10-20T00:00:00Z' });
    view = await openPage();
    expect(textOf(view)).toContain('53%');
    expect(descendants(view).filter((element) => element.tagName === 'A' && /setup/.test(textOf(element)))).toEqual([]);
  });

  it('explains how the information is used beside the checklist', async () => {
    const view = await openPage();
    expect(textOf(view)).toContain('How your information is used');
    expect(getByName(view, 'a', 'Read the privacy policy').getAttribute('href')).toBe('/privacy');
  });

  it('keeps every text readable', async () => {
    mocks.progress.mockResolvedValue({ role: 'tenant', step: 'budget', completed_at: null });
    expect(lowContrastText(await openPage())).toEqual([]);
  });
});
