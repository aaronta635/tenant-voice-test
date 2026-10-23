import { cleanup, click, descendants, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { ApiError, type Category, type Profile, type ProviderService, type ServiceProvider, type VerificationDocument } from '@/app/lib/api';
import OnboardingPage from './page';

const mockApi = vi.hoisted(() => ({
  categories: { list: vi.fn() },
  profiles: { me: vi.fn(), update: vi.fn() },
  providers: {
    mine: vi.fn(), createMine: vi.fn(), updateMine: vi.fn(), myServices: vi.fn(), myDocuments: vi.fn(),
    createService: vi.fn(), updateService: vi.fn(), deleteService: vi.fn(),
  },
}));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: '' }));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/navigation', () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams(router.search) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const cleaner: Category = {
  slug: 'cleaner', category: 'cleaner', name: 'Cleaner', description: 'Bond and home cleans.',
  icon_bg: null, badge: null, sort_order: 1, provider_count: 1, from_price: 150,
};
const me = {
  id: 'nina', role: 'service_provider', full_name: 'Nina New', email: 'nina@example.test', avatar_url: null,
  phone: null, location: 'Parramatta', state: 'NSW', postcode: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
} as Profile;
const liveProvider: ServiceProvider = {
  id: 'nina', profile_id: 'nina', category: 'cleaner', slug: 'nina-cleans', business_name: 'Nina Cleans',
  abn: null, tagline: 'Bond cleans', bio: 'Ten years of bond cleans across Western Sydney.', headline: 'Bond cleans',
  badge_label: null, years_experience: null, languages: [], skills: [], specialties: [], gallery_urls: [],
  service_radius_km: 15, website: null, response_time: null, availability_note: null, is_online: false,
  is_published: true, profile_completion: 89, rating_avg: 0, review_count: 0,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};
const bondClean = {
  id: 'svc-1', provider_id: 'nina', title: 'Bond clean', pricing_type: 'flat', price: 300, is_active: true, booking_count: 0,
} as ProviderService;
const pendingId = {
  id: 'doc-1', provider_id: 'nina', type: 'id', label: 'Government ID', document_url: null, status: 'pending',
  verified_at: null, created_at: '2026-10-02T00:00:00Z',
} as VerificationDocument;

function openWizard(provider: ServiceProvider) {
  mockApi.providers.mine.mockResolvedValue(provider);
  mockApi.providers.updateMine.mockImplementation(async (patch: Partial<ServiceProvider>) => ({ ...provider, ...patch }));
  return render(<OnboardingPage />);
}

function heading(view: FakeElement) {
  return textOf(descendants(view).find((element) => element.tagName === 'H1') as FakeElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  router.search = '';
  mockApi.categories.list.mockResolvedValue([cleaner]);
  mockApi.profiles.me.mockResolvedValue(me);
  mockApi.providers.myServices.mockResolvedValue([bondClean]);
  mockApi.providers.myDocuments.mockResolvedValue([pendingId]);
});
afterEach(cleanup);

describe('onboarding for a live profile below 100%', () => {
  it('opens at the step that fills the gap, not at the publish step', async () => {
    const view = await openWizard({ ...liveProvider, headline: null, tagline: null });
    expect(heading(view)).toBe('Complete your public profile');
    expect(textOf(view)).not.toMatch(/publish/i);
  });

  it('opens the service area step when the travel radius is missing', async () => {
    const view = await openWizard({ ...liveProvider, service_radius_km: null });
    expect(heading(view)).toBe('Set your service area');
  });

  it('ends on a review that offers no publishing and saves nothing new', async () => {
    const view = await openWizard(liveProvider);
    expect(heading(view)).toBe('Review your profile');
    expect(textOf(view)).not.toMatch(/publish/i);

    await click(getByName(view, 'button', 'Finish'));
    expect(mockApi.providers.updateMine).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/dashboard/profile');
  });

  it('keeps the tagline an older profile has when the public profile step is saved', async () => {
    const view = await openWizard({ ...liveProvider, headline: null, tagline: 'Fast and tidy', bio: 'Short' });
    expect(heading(view)).toBe('Complete your public profile');
    const headline = descendants(view).find((element) => element.id === 'onboarding-headline') as FakeElement;
    expect(headline.value).toBe('Fast and tidy');

    await typeInto(descendants(view).find((element) => element.id === 'onboarding-bio') as FakeElement, 'Ten years of bond cleans.');
    await click(getByName(view, 'button', 'Continue'));
    expect(mockApi.providers.updateMine).toHaveBeenCalledWith(expect.objectContaining({ headline: 'Fast and tidy', tagline: 'Fast and tidy' }));
  });
});

describe('the service area step', () => {
  async function openAtServiceArea() {
    mockApi.profiles.update.mockImplementation(async (patch: Partial<Profile>) => ({ ...me, ...patch }));
    const view = await openWizard({ ...liveProvider, service_radius_km: null });
    expect(heading(view)).toBe('Set your service area');
    return view;
  }
  const suburb = (view: FakeElement) => descendants(view).find((element) => element.id === 'onboarding-suburb') as FakeElement;

  it('clears the old state when the new suburb names none', async () => {
    const view = await openAtServiceArea();
    expect(suburb(view).value).toBe('Parramatta, NSW');

    await typeInto(suburb(view), 'Wollongong');
    await click(getByName(view, 'button', 'Continue'));
    expect(mockApi.profiles.update).toHaveBeenCalledWith({ location: 'Wollongong', state: null });
  });

  it('keeps the state the field shows', async () => {
    const view = await openAtServiceArea();
    await click(getByName(view, 'button', 'Continue'));
    expect(mockApi.profiles.update).toHaveBeenCalledWith({ location: 'Parramatta', state: 'NSW' });
  });

  it('needs a suburb, not only a state', async () => {
    const view = await openAtServiceArea();
    await typeInto(suburb(view), 'NSW');
    expect(getByName(view, 'button', 'Continue').hasAttribute('disabled')).toBe(true);
    expect(textOf(view)).toContain('Enter your base suburb to continue.');
  });
});

describe('onboarding for a profile that is not live yet', () => {
  it('still ends with Publish profile, which publishes it and lands on the dashboard', async () => {
    const view = await openWizard({ ...liveProvider, is_published: false, profile_completion: 89 });
    expect(heading(view)).toBe('Review & go live');

    await click(getByName(view, 'button', 'Publish profile'));
    expect(mockApi.providers.updateMine).toHaveBeenCalledWith(expect.objectContaining({ is_published: true }));
    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });

  it('says why a provider who is not verified yet cannot go live, and lets them finish later', async () => {
    const message = 'Your account needs to be verified before you can go live on the marketplace. Upload the documents it asks for, or wait for the review to finish.';
    const view = await openWizard({ ...liveProvider, is_published: false, profile_completion: 89 });
    mockApi.providers.updateMine.mockRejectedValue(new ApiError(403, message, {
      code: 'verification_required', action: 'go_live', status: 'pending', message,
      documents_href: '/dashboard/profile#verification-documents',
    }));

    await click(getByName(view, 'button', 'Publish profile'));
    await new Promise((done) => setTimeout(done, 0));

    const [alert] = descendants(view).filter((element) => element.getAttribute('role') === 'alert');
    expect(textOf(alert)).toBe(`Verification needed${message}Go to your documents`);
    expect(getByName(view, 'a', 'Go to your documents').getAttribute('href')).toBe('/dashboard/profile#verification-documents');
    expect(getByName(view, 'a', 'finish later').getAttribute('href')).toBe('/dashboard');
    expect(textOf(document.activeElement as unknown as FakeElement)).toContain('Verification needed');
    expect(router.push).not.toHaveBeenCalled();
    expect(heading(view)).toBe('Review & go live');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('skips to the dashboard, which offers to finish setup', async () => {
    const view = await openWizard({ ...liveProvider, is_published: false, category: null, profile_completion: 0 });
    expect(heading(view)).toBe('Choose your category');
    expect(getByName(view, 'a', 'Skip for now').getAttribute('href')).toBe('/dashboard');
  });
});

describe('a new provider going through every step', () => {
  it('saves each step through the provider workspace, then publishes and lands on the dashboard', async () => {
    const fresh = {
      ...liveProvider, category: null, business_name: null, bio: null, headline: null, tagline: null,
      service_radius_km: null, is_published: false, profile_completion: 11,
    };
    let saved: ServiceProvider = fresh;
    mockApi.providers.myServices.mockResolvedValue([]);
    mockApi.providers.myDocuments.mockResolvedValue([pendingId]);
    mockApi.providers.createService.mockResolvedValue(bondClean);
    mockApi.profiles.update.mockImplementation(async (patch: Partial<Profile>) => ({ ...me, ...patch }));
    mockApi.providers.mine.mockImplementation(async () => saved);
    const view = await render(<OnboardingPage />);
    mockApi.providers.updateMine.mockImplementation(async (patch: Partial<ServiceProvider>) => (saved = { ...saved, ...patch }));

    await click(getByName(view, 'button', 'Cleaner'));
    await click(getByName(view, 'button', 'Continue'));
    expect(mockApi.providers.updateMine).toHaveBeenLastCalledWith({ category: 'cleaner' });

    await typeInto(descendants(view).find((element) => element.id === 'onboarding-service-0') as FakeElement, 'Bond clean');
    await typeInto(descendants(view).find((element) => element.id === 'onboarding-service-0-price') as FakeElement, '300');
    // An enabled service needs a description (the shared rules): nothing is sent without one.
    await click(getByName(view, 'button', 'Continue'));
    expect(mockApi.providers.createService).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Service 1: Add a description to enable this service.');
    await typeInto(descendants(view).find((element) => element.id === 'onboarding-service-0-description') as FakeElement, 'Kitchen, bathrooms and carpets.');
    await click(getByName(view, 'button', 'Continue'));
    expect(mockApi.providers.createService).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Bond clean', price: 300, description: 'Kitchen, bathrooms and carpets.',
    }));

    await click(getByName(view, 'button', 'Continue'));
    expect(mockApi.profiles.update).toHaveBeenCalledWith({ location: 'Parramatta', state: 'NSW' });
    expect(mockApi.providers.updateMine).toHaveBeenLastCalledWith({ service_radius_km: 15 });

    // The credential step: an ID is already in review.
    await click(getByName(view, 'button', 'Continue'));
    await typeInto(descendants(view).find((element) => element.id === 'onboarding-name') as FakeElement, 'Nina Cleans');
    await typeInto(descendants(view).find((element) => element.id === 'onboarding-bio') as FakeElement, 'Ten years of bond cleans.');
    await click(getByName(view, 'button', 'Continue'));
    expect(mockApi.providers.updateMine).toHaveBeenLastCalledWith(expect.objectContaining({ business_name: 'Nina Cleans', bio: 'Ten years of bond cleans.' }));

    expect(heading(view)).toBe('Review & go live');
    await click(getByName(view, 'button', 'Publish profile'));
    expect(mockApi.providers.updateMine).toHaveBeenLastCalledWith(expect.objectContaining({ is_published: true }));
    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });
});

describe('onboarding that carries a task from sign-up', () => {
  const addService = '/dashboard/services?new=1';

  it('resumes the task once the profile is published', async () => {
    router.search = `next=${encodeURIComponent(addService)}`;
    const view = await openWizard({ ...liveProvider, is_published: false, profile_completion: 89 });
    await click(getByName(view, 'button', 'Publish profile'));
    expect(router.push).toHaveBeenCalledWith(addService);
  });

  it('resumes the task when setup is skipped', async () => {
    router.search = `next=${encodeURIComponent(addService)}`;
    const view = await openWizard({ ...liveProvider, headline: null, tagline: null });
    expect(getByName(view, 'a', 'Skip for now').getAttribute('href')).toBe(addService);
  });

  it('ignores a return path to another site', async () => {
    router.search = `next=${encodeURIComponent('//evil.example/dashboard')}`;
    const view = await openWizard(liveProvider);
    expect(getByName(view, 'a', 'Skip for now').getAttribute('href')).toBe('/dashboard/profile');
    await click(getByName(view, 'button', 'Finish'));
    expect(router.push).toHaveBeenCalledWith('/dashboard/profile');
  });
});
