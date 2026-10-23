import { cleanup, click, descendants, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { MyProfile } from '@/app/lib/my-profile';
import type { OnboardingProgress } from '@/app/lib/onboarding';
import type { DocumentChecklist, RequirementStatus } from '@/app/lib/profile-documents';
import { myProfile } from '@/app/test-utils/my-profile';
import OwnerProfileCompletionPage from '@/app/(owner)/owner/profile/completion/page';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<MyProfile>>(),
  checklist: vi.fn<() => Promise<DocumentChecklist>>(),
  progress: vi.fn<() => Promise<OnboardingProgress>>(),
}));
vi.mock('@/app/lib/my-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/my-profile')>()),
  getMyProfile: mocks.read,
}));
vi.mock('@/app/lib/profile-documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/profile-documents')>()),
  documentsApi: { checklist: mocks.checklist },
}));
vi.mock('@/app/lib/onboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/onboarding')>()),
  onboardingApi: { get: mocks.progress, save: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const LEO = 'e2000000-0000-4000-8000-000000000001';

function landlord(over: Partial<MyProfile['landlord'] & object> = {}): MyProfile {
  const profile = myProfile({ id: LEO, full_name: 'Leo Landlord', phone: '0400 333 444', location: 'Newtown' }, { landlord: true });
  return { ...profile, landlord: { agency_name: 'Harbour Homes', license_number: null, portfolio_size: null, bio: null, ...over } };
}

function checklist(photoId: RequirementStatus, authority: RequirementStatus): DocumentChecklist {
  return {
    role: 'landlord',
    can_share: false,
    types: [],
    requirements: [
      { key: 'photo_id', label: 'Photo ID', types: ['PASSPORT'], status: photoId },
      { key: 'property_authority', label: 'Proof of ownership or management authority', types: ['PROOF_OF_PROPERTY_OWNERSHIP'], status: authority },
    ],
    requirements_met: false,
    account: { status: 'pending', rejection_reason: null, approved_at: null, account_rejected: false },
    documents: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(landlord());
  mocks.checklist.mockResolvedValue(checklist('pending', 'missing'));
  mocks.progress.mockResolvedValue({ role: 'landlord', step: null, completed_at: null });
});
afterEach(cleanup);

const row = (view: FakeElement, label: string) =>
  descendants(view).find((element) => element.tagName === 'LI' && textOf(element).startsWith(label)) as FakeElement;

describe('a landlord\'s profile completion', () => {
  it('lists their details and each verification requirement as the server reports them', async () => {
    const view = await render(<OwnerProfileCompletionPage />);

    expect(textOf(view)).toContain('2 of 3 required items done');
    expect(textOf(view)).toContain('Account verification: Not verified yet.');
    const bars = descendants(view).filter((element) => element.getAttribute('role') === 'progressbar');
    expect(bars.map((bar) => [bar.getAttribute('aria-label'), bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]))
      .toEqual([['Required items', '2', '3'], ['Profile boosters', '2', '3']]);

    expect(textOf(row(view, 'Photo ID'))).toContain('In review');
    expect(textOf(row(view, 'Proof of ownership or management authority'))).toContain('Not uploaded');
    expect(getByName(view, 'a', 'Complete Proof of ownership or management authority').getAttribute('href'))
      .toBe('/owner/profile/verification');
    expect(getByName(view, 'a', 'Review Personal details').getAttribute('href')).toBe('/owner/profile/edit');
    expect(getByName(view, 'a', 'Complete About you').getAttribute('href')).toBe('/owner/profile/edit');
    expect(getByName(view, 'a', 'Preview public profile').getAttribute('href')).toBe(`/public/${LEO}`);
  });

  it('counts a rejected document as still to do, and a phone as part of the personal details', async () => {
    const noPhone = landlord();
    mocks.read.mockResolvedValue({ ...noPhone, phone: null });
    mocks.checklist.mockResolvedValue(checklist('rejected', 'verified'));
    const view = await render(<OwnerProfileCompletionPage />);

    expect(textOf(view)).toContain('1 of 3 required items done');
    expect(textOf(row(view, 'Photo ID'))).toContain('Rejected');
    expect(textOf(row(view, 'Proof of ownership or management authority'))).toContain('Verified');
    expect(textOf(row(view, 'Personal details'))).toContain('Not started');
  });

  it('offers to start or finish setup', async () => {
    let view = await render(<OwnerProfileCompletionPage />);
    expect(getByName(view, 'a', 'Start setup').getAttribute('href')).toBe('/owner/onboarding');

    await cleanup();
    mocks.progress.mockResolvedValue({ role: 'landlord', step: 'about', completed_at: null });
    view = await render(<OwnerProfileCompletionPage />);
    expect(textOf(view)).toContain('Pick up at "Introduction".');
    expect(getByName(view, 'a', 'Finish setup').getAttribute('href')).toBe('/owner/onboarding');
  });

  it('offers a retry when the page cannot load', async () => {
    mocks.checklist.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<OwnerProfileCompletionPage />);
    expect(textOf(view)).toContain('Your profile could not be loaded');
    expect(textOf(view)).toContain('The service is temporarily unavailable. Please try again.');

    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('2 of 3 required items done');
  });

  it('keeps every text readable', async () => {
    mocks.progress.mockResolvedValue({ role: 'landlord', step: 'about', completed_at: null });
    expect(lowContrastText(await render(<OwnerProfileCompletionPage />))).toEqual([]);
  });
});
