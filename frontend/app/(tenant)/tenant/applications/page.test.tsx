import { cleanup, click, descendants, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Application, type ApplicationStage } from '@/app/lib/api';
import type { MyProfile } from '@/app/lib/my-profile';
import { myProfile } from '@/app/test-utils/my-profile';
import TenantApplicationsPage from './page';

const mockApi = vi.hoisted(() => ({
  applications: { listMine: vi.fn(), withdraw: vi.fn() },
  notifications: { list: vi.fn() },
  profiles: { me: vi.fn() },
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/tenant/applications', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <span role="img" aria-label={alt} data-src={src} /> }));
// The shell's own data is its tests' business.
vi.mock('@/app/components/tenant/TenantShell', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const WITHDRAWABLE: ApplicationStage[] = ['submitted', 'under_review', 'shortlisted'];

function application(id: string, stage: ApplicationStage, over: Partial<Application> = {}): Application {
  return {
    id, property_id: `listing-${id}`, tenant_id: 'me', status: 'new', stage, can_withdraw: WITHDRAWABLE.includes(stage),
    annual_income: null, move_in_date: '2026-11-15', occupants: 2, rent_offered: 620, tenant_score: null,
    shortlisted: stage === 'shortlisted', has_pets: false, message: null, documents: [], history: [],
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    listing: { id: `listing-${id}`, title: `Home ${id}`, suburb: 'Newtown', state: 'NSW', photo_url: null, weekly_rent: 650, is_public: true },
    ...over,
  };
}

async function loadedPage(applications: Application[], profile: MyProfile | null = null) {
  mockApi.applications.listMine.mockResolvedValue(applications);
  mockApi.notifications.list.mockResolvedValue([]);
  mockApi.profiles.me.mockResolvedValue(profile);
  return render(<TenantApplicationsPage />);
}

const cards = (view: FakeElement) =>
  descendants(view).filter((element) => element.tagName === 'H3').map((heading) => heading.parentElement?.parentElement as FakeElement);
const titles = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'H3').map(textOf);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the tenant applications page', () => {
  it("names each application's real listing, suburb and stage, also once it is no longer advertised", async () => {
    const view = await loadedPage([
      application('a', 'shortlisted'),
      application('b', 'approved', { listing: { id: 'listing-b', title: 'Garden cottage', suburb: 'Leichhardt', state: 'NSW', photo_url: 'https://cdn.example.test/b.jpg', weekly_rent: 700, is_public: false } }),
    ]);

    expect(titles(view)).toEqual(['Home a', 'Garden cottage']);
    const [first, second] = cards(view);
    expect(textOf(first)).toContain('Newtown, NSW');
    expect(textOf(first)).toContain('Shortlisted');
    expect(textOf(first)).toContain('$620 a week');
    expect(getByName(first, 'a', 'View Property').getAttribute('href')).toBe('/tenant/properties/listing-a');
    expect(textOf(second)).toContain('Leichhardt, NSW');
    expect(textOf(second)).toContain('This listing is no longer advertised.');
    expect(textOf(view)).not.toMatch(/Property listing-/);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('offers Withdraw only while the landlord has not decided', async () => {
    const view = await loadedPage((['submitted', 'under_review', 'shortlisted', 'approved', 'declined', 'withdrawn', 'expired'] as const)
      .map((stage) => application(stage, stage)));

    expect(cards(view).map((card) => [textOf(card.querySelectorAll('h3')[0]), descendants(card).some((element) => element.tagName === 'BUTTON' && textOf(element) === 'Withdraw')]))
      .toEqual([
        ['Home submitted', true], ['Home under_review', true], ['Home shortlisted', true], ['Home approved', false],
        ['Home declined', false], ['Home withdrawn', false], ['Home expired', false],
      ]);
    expect(textOf(view)).toContain('Withdrawn');
  });

  it("says on the card why a withdrawal was refused and keeps the list in view", async () => {
    const view = await loadedPage([application('new', 'submitted'), application('other', 'under_review')]);
    mockApi.applications.withdraw.mockRejectedValue(
      new ApiError(409, 'This application has been decided, so it can no longer be withdrawn.'),
    );

    await click(descendants(cards(view)[0]).find((element) => textOf(element) === 'Withdraw') as FakeElement);

    expect(textOf(cards(view)[0])).toContain('This application has been decided, so it can no longer be withdrawn.');
    expect(titles(view)).toEqual(['Home new', 'Home other']);
    // The list was read again, so a decision made meanwhile shows.
    expect(mockApi.applications.listMine).toHaveBeenCalledTimes(2);
  });

  it("shows the landlord's note and what went with the application", async () => {
    const view = await loadedPage([application('a', 'declined', {
      documents: [
        { id: 'd1', document_type: 'PASSPORT', label: 'Passport', verified: true, shared: true },
        { id: 'd2', document_type: 'OTHER', label: 'Payslip', verified: false, shared: false },
      ],
      history: [
        { from_stage: null, to_stage: 'submitted', note: null, by: 'applicant', created_at: '2026-10-01T00:00:00Z' },
        { from_stage: 'submitted', to_stage: 'declined', note: 'We chose a family.', by: 'landlord', created_at: '2026-10-02T00:00:00Z' },
      ],
    })]);

    const text = textOf(view);
    expect(text).toContain('From the landlordWe chose a family.');
    expect(text).toContain('Documents shared: Passport, Payslip (no longer shared)');
    expect(text).toContain('Declined by the landlord');
    expect(text).toContain('Submitted by you');
  });

  it('says "No photo yet" for a listing without photos, never a stock photo', async () => {
    const view = await loadedPage([application('a', 'submitted')]);

    expect(textOf(view)).toContain('No photo yet');
    expect(textOf(view)).not.toContain('Demo');
  });

  it('searches and filters the applications by where they stand', async () => {
    const view = await loadedPage([application('a', 'submitted'), application('b', 'approved'), application('c', 'withdrawn')]);

    await typeInto(getByName(view, 'input', 'Search applications'), 'home b');
    expect(titles(view)).toEqual(['Home b']);
    await click(getByName(view, 'button', 'Reset Filters'));
    expect(titles(view)).toEqual(['Home a', 'Home b', 'Home c']);

    const approved = descendants(view).find((element) => element.tagName === 'LABEL' && textOf(element) === 'Approved') as FakeElement;
    const box = approved.querySelectorAll('input')[0];
    box.checked = false;
    await click(box);
    expect(titles(view)).toEqual(['Home a', 'Home c']);
  });

  it('shows the loading, empty and error states', async () => {
    mockApi.applications.listMine.mockReturnValue(new Promise(() => {}));
    mockApi.notifications.list.mockResolvedValue([]);
    mockApi.profiles.me.mockResolvedValue(null);
    expect(textOf(await render(<TenantApplicationsPage />))).toContain('Loading your applications…');
    await cleanup();

    expect(textOf(await loadedPage([]))).toContain("You haven't applied to any properties yet.");
    await cleanup();

    mockApi.applications.listMine.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const failed = await render(<TenantApplicationsPage />);
    expect(textOf(failed)).toContain('The service is temporarily unavailable.');
    mockApi.applications.listMine.mockResolvedValue([application('a', 'submitted')]);
    await click(getByName(failed, 'button', 'Try again'));
    expect(titles(failed)).toEqual(['Home a']);
  });
});

describe('the tenant applications page profile completion', () => {
  it('shows the completion the server worked out and links to the completion page', async () => {
    // Name, email, phone, suburb and state are filled in: counting those fields said 83%.
    const view = await loadedPage([], myProfile({ completion: { ...myProfile().completion!, score: 53 } }));

    expect(textOf(view)).toContain('53% Complete');
    expect(getByName(view, 'a', 'Finish Setup ›').getAttribute('href')).toBe('/tenant/profile-completion');
  });

  it('shows Finish Setup and View All at AA contrast and underlined, as links beside text of a near colour', async () => {
    const view = await loadedPage([], myProfile({ completion: { ...myProfile().completion!, score: 53 } }));

    for (const name of ['Finish Setup ›', 'View All']) {
      const link = getByName(view, 'a', name);
      expect(lowContrastText(link)).toEqual([]);
      expect(link.className.split(/\s+/)).toContain('underline');
    }
  });
});
