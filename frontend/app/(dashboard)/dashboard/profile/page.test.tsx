import { cleanup, click, descendants, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Profile, type ServiceProvider, type VerificationDocument } from '@/app/lib/api';
import ProviderProfilePage from './page';

const mockApi = vi.hoisted(() => ({
  profiles: { me: vi.fn(), update: vi.fn() },
  providers: { mine: vi.fn(), updateMine: vi.fn(), myServices: vi.fn(), myDocuments: vi.fn() },
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  // data-next-link tells a next/link apart from a plain <a>.
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} data-next-link="" {...props}>{children}</a>,
}));

const me = {
  id: 'nina', role: 'service_provider', full_name: 'Nina New', email: 'nina@example.test', avatar_url: null,
  phone: '0400 000 000', location: 'Melbourne', state: 'VIC', postcode: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
} as Profile;
const provider: ServiceProvider = {
  id: 'nina', profile_id: 'nina', category: 'cleaner', slug: 'nina-cleans', business_name: 'Nina Cleans',
  abn: null, tagline: 'Bond cleans', bio: 'Ten years of bond cleans across Western Sydney.', headline: 'Bond cleans',
  badge_label: null, years_experience: null, languages: [], skills: [], specialties: [], gallery_urls: [],
  service_radius_km: 15, website: 'https://old.example', response_time: null, availability_note: null,
  is_online: false, is_published: true, profile_completion: 89, rating_avg: 0, review_count: 0,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

/** The input behind a Field while editing (ids come from the label). */
function input(view: FakeElement, id: string) {
  return descendants(view).find((element) => element.id === id) as FakeElement;
}

/** What a Field shows once editing ends. */
function shown(view: FakeElement, id: string) {
  const label = descendants(view).find((element) => element.tagName === 'LABEL' && element.getAttribute('for') === id) as FakeElement;
  return textOf(label.nextSibling as FakeElement);
}

async function editAndSave(view: FakeElement, values: Record<string, string>) {
  await click(getByName(view, 'button', 'Edit profile'));
  for (const [id, value] of Object.entries(values)) await typeInto(input(view, id), value);
  await click(getByName(view, 'button', 'Save changes'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.profiles.me.mockResolvedValue(me);
  mockApi.providers.mine.mockResolvedValue(provider);
  mockApi.providers.myServices.mockResolvedValue([]);
  mockApi.providers.myDocuments.mockResolvedValue([]);
  mockApi.profiles.update.mockImplementation(async (patch: Partial<Profile>) => ({ ...me, ...patch }));
});
afterEach(cleanup);

describe('saving the provider profile', () => {
  it('shows every field as the server stored it, not as it was typed', async () => {
    // This server keeps the website it was asked to clear.
    mockApi.providers.updateMine.mockImplementation(async (patch: Partial<ServiceProvider>) => ({ ...provider, ...patch, website: provider.website }));
    const view = await render(<ProviderProfilePage />);

    await editAndSave(view, {
      'field-location': 'Surry Hills ,Sydney,NSW',
      'field-display-/-business-name': '  Harbour Cleans  ',
      'field-website': '',
    });

    expect(mockApi.providers.updateMine).toHaveBeenCalledWith({ business_name: 'Harbour Cleans', website: null });
    expect(textOf(view)).toContain('Profile saved.');
    expect(shown(view, 'field-location')).toBe('Surry Hills, Sydney, NSW');
    expect(shown(view, 'field-website')).toBe('https://old.example');

    await click(getByName(view, 'button', 'Edit profile'));
    expect(input(view, 'field-display-/-business-name').value).toBe('Harbour Cleans');
    await typeInto(input(view, 'field-location'), 'Somewhere else');
    await click(getByName(view, 'button', 'Cancel'));
    expect(shown(view, 'field-location')).toBe('Surry Hills, Sydney, NSW');
  });

  it('clears the old state when the new location names none', async () => {
    const view = await render(<ProviderProfilePage />);
    expect(shown(view, 'field-location')).toBe('Melbourne, VIC');

    await editAndSave(view, { 'field-location': 'Wollongong' });
    expect(mockApi.profiles.update).toHaveBeenCalledWith(expect.objectContaining({ location: 'Wollongong', state: null }));
    expect(shown(view, 'field-location')).toBe('Wollongong');
  });

  it('keeps the account details that saved when the business details fail', async () => {
    mockApi.providers.updateMine.mockRejectedValue(new ApiError(503, 'Service unavailable'));
    const view = await render(<ProviderProfilePage />);

    await editAndSave(view, { 'field-phone': '0411 111 111', 'field-website': 'https://new.example' });
    expect(textOf(view)).toContain('Service unavailable');

    await click(getByName(view, 'button', 'Cancel'));
    expect(shown(view, 'field-phone')).toBe('0411 111 111');
    expect(shown(view, 'field-website')).toBe('https://old.example');
  });
});

describe('profile page links', () => {
  it('keeps the small section links at AA contrast', async () => {
    const view = await render(<ProviderProfilePage />);

    expect(getByName(view, 'a', 'Manage →').getAttribute('href')).toBe('/dashboard/services');
    expect(getByName(view, 'a', 'Set hours →').getAttribute('href')).toBe('/dashboard/availability');
    expect(lowContrastText(view)).toEqual([]);
  });
});

describe('profile identity card', () => {
  it('hides the initials from screen readers, which read the name below them', async () => {
    const view = await render(<ProviderProfilePage />);
    const initials = descendants(view).filter((element) => textOf(element) === 'NC');

    expect(getByName(view, 'h2', 'Nina Cleans')).toBeTruthy();
    expect(initials).toHaveLength(1);
    expect(initials[0].getAttribute('aria-hidden')).toBe('true');
  });
});

describe('profile credentials link', () => {
  const pendingAbn = {
    id: 'abn', type: 'abn', label: 'ABN registration', status: 'pending', document_url: null, created_at: '2026-10-01T00:00:00Z',
  } as VerificationDocument;

  it('takes a live provider to the credentials further down this page, not to onboarding', async () => {
    mockApi.providers.mine.mockResolvedValue({ ...provider, profile_completion: 100 });
    mockApi.providers.myDocuments.mockResolvedValue([pendingAbn]);
    const view = await render(<ProviderProfilePage />);
    const link = getByName(view, 'a', 'Manage credentials');
    const target = descendants(view).find((element) => `#${element.id}` === link.getAttribute('href'));

    expect(link.getAttribute('href')).toBe('#verification-documents');
    expect(target?.tagName).toBe('H2');
    expect(textOf(target as FakeElement)).toBe('Verification documents');
    // Following a link focuses its target only if the target can take focus.
    expect(target?.getAttribute('tabindex')).toBe('-1');
  });

  it('is a next/link, so that Back from a page opened afterwards shows this one again', async () => {
    mockApi.providers.mine.mockResolvedValue({ ...provider, profile_completion: 100 });
    mockApi.providers.myDocuments.mockResolvedValue([pendingAbn]);
    const view = await render(<ProviderProfilePage />);

    // A plain <a href="#…"> makes a history entry of the browser's own, and
    // Next leaves the page on screen when Back returns to one of those.
    expect(getByName(view, 'a', 'Manage credentials').hasAttribute('data-next-link')).toBe(true);
  });
});

describe('the provider ABN', () => {
  it('saves an ABN that passes the ABR checksum, grouped as the ABR prints it', async () => {
    mockApi.providers.updateMine.mockImplementation(async (patch: Partial<ServiceProvider>) => ({ ...provider, ...patch }));
    const view = await render(<ProviderProfilePage />);
    expect(shown(view, 'field-abn')).toBe('Not provided');

    await editAndSave(view, { 'field-abn': '51824753556' });

    expect(mockApi.providers.updateMine).toHaveBeenCalledWith({ abn: '51 824 753 556' });
    expect(shown(view, 'field-abn')).toBe('51 824 753 556');
  });

  it('keeps an ABN that fails the check in the form, says why and sends nothing', async () => {
    const view = await render(<ProviderProfilePage />);

    await editAndSave(view, { 'field-abn': '51 824 753 557' });

    expect(mockApi.providers.updateMine).not.toHaveBeenCalled();
    expect(mockApi.profiles.update).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Enter a valid 11-digit ABN');
    expect((document.activeElement as unknown as FakeElement).id).toBe('field-abn');
    expect(input(view, 'field-abn').value).toBe('51 824 753 557');
  });

  it('describes the field with its hint while editing', async () => {
    const view = await render(<ProviderProfilePage />);
    await click(getByName(view, 'button', 'Edit profile'));

    const hint = descendants(view).find((element) => element.id === input(view, 'field-abn').getAttribute('aria-describedby'));
    expect(textOf(hint as FakeElement)).toMatch(/^Optional\. The 11 digits from ABN Lookup/);
  });

  it('never blocks another edit with an ABN another app stored', async () => {
    mockApi.providers.mine.mockResolvedValue({ ...provider, abn: 'ABN pending' });
    const view = await render(<ProviderProfilePage />);

    await editAndSave(view, { 'field-phone': '0411 111 111' });

    expect(mockApi.profiles.update).toHaveBeenCalledWith(expect.objectContaining({ phone: '0411 111 111' }));
    expect(textOf(view)).toContain('Profile saved.');
  });

  it('clears the ABN when the field is emptied', async () => {
    mockApi.providers.mine.mockResolvedValue({ ...provider, abn: '51 824 753 556' });
    mockApi.providers.updateMine.mockImplementation(async (patch: Partial<ServiceProvider>) => ({ ...provider, ...patch }));
    const view = await render(<ProviderProfilePage />);
    expect(shown(view, 'field-abn')).toBe('51 824 753 556');

    await editAndSave(view, { 'field-abn': '' });

    expect(mockApi.providers.updateMine).toHaveBeenCalledWith({ abn: null });
    expect(shown(view, 'field-abn')).toBe('Not provided');
  });
});
