import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Profile, type ServiceProvider } from '@/app/lib/api';
import type { MyProfile, MyProfileUpdate } from '@/app/lib/my-profile';
import { myProfile, profileServer } from '@/app/test-utils/my-profile';
import SettingsPage from './page';

const mockApi = vi.hoisted(() => ({
  profiles: { me: vi.fn() },
  providers: { mine: vi.fn(), updateMine: vi.fn() },
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
const mySave = vi.hoisted(() => vi.fn<(patch: MyProfileUpdate) => Promise<MyProfile>>());
vi.mock('@/app/lib/my-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/my-profile')>()),
  updateMyProfile: mySave,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.profiles.me.mockResolvedValue({
    id: 'nina', role: 'service_provider', full_name: 'Nina New', email: 'nina@example.test', created_at: '2026-10-01T00:00:00Z',
  } as Profile);
  mockApi.providers.mine.mockRejectedValue(new ApiError(404, 'Service provider not found'));
});
afterEach(cleanup);

describe('SettingsPage without a provider profile', () => {
  it('links to onboarding in text at AA contrast, underlined like the rest of the sentence links', async () => {
    const view = await render(<SettingsPage />);
    const link = getByName(view, 'a', 'Finish onboarding');

    expect(link.getAttribute('href')).toBe('/dashboard/onboarding');
    expect(link.className.split(/\s+/)).toContain('underline');
    expect(lowContrastText(view)).toEqual([]);
  });
});

describe('SettingsPage pausing a live profile', () => {
  it('disables every button in the pause dialog while the pause saves', async () => {
    const live = { id: 'p1', profile_id: 'nina', business_name: 'Nina Cleans', is_published: true, is_online: true } as ServiceProvider;
    let finish!: (provider: ServiceProvider) => void;
    mockApi.providers.mine.mockResolvedValue(live);
    mockApi.providers.updateMine.mockReturnValue(new Promise<ServiceProvider>((done) => { finish = done; }));
    const view = await render(<SettingsPage />);
    await click(getByName(view, 'button', /^List my profile in the marketplace/));
    await click(getByName(view, 'button', 'Pause profile'));

    // A stray Enter on Keep profile live used to close the dialog mid-save.
    expect(getByName(view, 'button', 'Keep profile live').hasAttribute('disabled')).toBe(true);
    expect(getByName(view, 'button', 'Pause profile').hasAttribute('disabled')).toBe(true);

    await act(async () => finish({ ...live, is_published: false }));
    await settle();
  });
});

describe('SettingsPage notifications and privacy', () => {
  it('saves the switches shared with the mobile app, in a provider\'s words', async () => {
    const me = { ...myProfile({ role: 'service_provider', tenant: null, completion: null }) };
    const server = profileServer(me);
    mySave.mockImplementation(server.save);
    mockApi.profiles.me.mockResolvedValue(me);
    const view = await render(<SettingsPage />);

    expect(textOf(view)).toContain('Repair jobs');
    expect(textOf(view)).not.toContain('Property matches');
    const label = descendants(view).find((element) => element.tagName === 'LABEL' && textOf(element).startsWith('Bookings'));
    const bookings = descendants(view).find((element) => element.id === label?.getAttribute('for')) as FakeElement;
    bookings.checked = false;
    await click(bookings);
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
    await settle();

    expect(mySave).toHaveBeenCalledWith({ settings: expect.objectContaining({
      notification_preferences: expect.objectContaining({ booking: false, push_enabled: true }),
      privacy: { public_profile: true, discoverable: true, allow_messages: true, show_contact: false },
    }) });
    expect(textOf(view)).toContain('Settings saved to your account.');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('shows no switches until the profile holds them', async () => {
    const view = await render(<SettingsPage />);

    expect(textOf(view)).not.toContain('All notifications');
  });
});
