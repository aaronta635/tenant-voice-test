import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { MyProfile, MyProfileUpdate } from '@/app/lib/my-profile';
import { myProfile, profileServer } from '@/app/test-utils/my-profile';
import OwnerEditProfilePage from './edit/page';
import OwnerProfilePage from './page';
import OwnerAccountSettingsPage from './settings/page';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<MyProfile>>(),
  save: vi.fn<(patch: MyProfileUpdate) => Promise<MyProfile>>(),
}));
vi.mock('@/app/lib/my-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/my-profile')>()),
  getMyProfile: mocks.read,
  updateMyProfile: mocks.save,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { dashboard: { owner: async () => ({ property_count: 2, application_count: 1, active_lease_count: 1, unread_notifications: 0 }) } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

let server: ReturnType<typeof profileServer>;

beforeEach(() => {
  // Also drops a once-only answer a test left unused.
  vi.resetAllMocks();
  server = profileServer(myProfile({
    full_name: 'Olly Owner',
    landlord: { agency_name: 'Harbour Homes', license_number: '20012345', portfolio_size: 3, bio: 'Family-run rentals.' },
  }, { landlord: true }));
  mocks.read.mockImplementation(server.read);
  mocks.save.mockImplementation(server.save);
});
afterEach(cleanup);

function field(view: FakeElement, label: string): FakeElement {
  const labels = descendants(view).filter((element) => element.tagName === 'LABEL' && textOf(element) === label);
  if (labels.length !== 1) throw new Error(`Expected one label "${label}", found ${labels.length}`);
  const id = labels[0].getAttribute('for');
  const control = id ? descendants(view).find((element) => element.id === id) : descendants(labels[0]).find((element) => element.tagName === 'INPUT');
  if (!control) throw new Error(`No control for "${label}"`);
  return control;
}

/** What a control shows; the test DOM leaves a textarea's first value in defaultValue, where React puts it. */
const shown = (control: FakeElement) => control.value || (control as FakeElement & { defaultValue?: string }).defaultValue || '';

const submit = (view: FakeElement) => dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
const byRole = (view: FakeElement, role: string) =>
  descendants(view).filter((element) => element.getAttribute('role') === role).map(textOf).filter(Boolean);

describe('the owner profile edit page', () => {
  it('loads the account and its rental business details', async () => {
    const view = await render(<OwnerEditProfilePage />);

    expect(field(view, 'Full name').value).toBe('Olly Owner');
    expect(field(view, 'Agency or business name').value).toBe('Harbour Homes');
    expect(field(view, 'Licence number').value).toBe('20012345');
    expect(field(view, 'Properties you rent out').value).toBe('3');
    expect(shown(field(view, 'About you'))).toBe('Family-run rentals.');
  });

  it('saves only what changed of the account and business details, as they come back after a reload', async () => {
    let view = await render(<OwnerEditProfilePage />);
    await typeInto(field(view, 'Agency or business name'), 'Harbour Homes Pty Ltd');
    await typeInto(field(view, 'Properties you rent out'), '4');
    await typeInto(field(view, 'About you'), '');
    await typeInto(field(view, 'Postcode'), '2043');
    await submit(view);

    expect(mocks.save).toHaveBeenCalledWith({
      postcode: '2043',
      landlord: { agency_name: 'Harbour Homes Pty Ltd', portfolio_size: 4, bio: null },
    });
    expect(byRole(view, 'status')).toContain('Profile saved to your account.');

    await cleanup();
    view = await render(<OwnerEditProfilePage />);
    expect(field(view, 'Agency or business name').value).toBe('Harbour Homes Pty Ltd');
    expect(shown(field(view, 'About you'))).toBe('');
  });

  it('refuses a postcode or licence the server would refuse, and shows the server reason', async () => {
    const view = await render(<OwnerEditProfilePage />);
    await typeInto(field(view, 'Postcode'), '20000');
    await submit(view);
    expect(byRole(view, 'alert')).toEqual(['Enter a 4-digit postcode.']);
    expect(mocks.save).not.toHaveBeenCalled();

    await typeInto(field(view, 'Postcode'), '2043');
    mocks.save.mockRejectedValueOnce(new ApiError(409, 'Your profile changed while this was saving. Please try again.'));
    await submit(view);
    expect(byRole(view, 'alert')).toEqual(['Your profile changed while this was saving. Please try again.']);
  });

  it('never sends back a stored value that today\'s checks would refuse, and saves nothing unchanged', async () => {
    server = profileServer(myProfile({ phone: 'call reception', postcode: '20000' }, { landlord: true }));
    mocks.read.mockImplementation(server.read);
    mocks.save.mockImplementation(server.save);
    const view = await render(<OwnerEditProfilePage />);
    await submit(view);
    expect(byRole(view, 'status')).toEqual(['No changes to save.']);
    expect(mocks.save).not.toHaveBeenCalled();

    await typeInto(field(view, 'About you'), 'Family-run rentals.');
    await submit(view);
    expect(byRole(view, 'alert')).toEqual([]);
    expect(mocks.save).toHaveBeenCalledWith({ landlord: { bio: 'Family-run rentals.' } });
  });

  it('keeps AA contrast, also under the pointer', async () => {
    const view = await render(<OwnerEditProfilePage />);

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

describe('the owner account settings page', () => {
  it('saves the switches an owner has, in an owner\'s words', async () => {
    const view = await render(<OwnerAccountSettingsPage />);

    expect(textOf(view)).toContain('New applications');
    expect(textOf(view)).not.toContain('Share my readiness score');
    const applications = field(view, 'New applicationsWhen a tenant applies for one of your listings.');
    applications.checked = false;
    await click(applications);
    await submit(view);

    expect(mocks.save).toHaveBeenCalledWith({
      settings: {
        notification_preferences: {
          push_enabled: true, application: false, message: true, repairs: true, property: true, review: true,
          booking: true, profile_updates: true,
        },
        privacy: { public_profile: true, discoverable: true, allow_messages: true, show_contact: false },
      },
    });
    expect(byRole(view, 'status')).toContain('Settings saved to your account.');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('offers a retry when the settings cannot be loaded', async () => {
    mocks.read.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<OwnerAccountSettingsPage />);

    expect(textOf(view)).toContain('Your settings could not be loaded');
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('New applications');
  });
});

describe('the owner profile page', () => {
  it('shows the business details saved to the account', async () => {
    const view = await render(<OwnerProfilePage />);

    expect(textOf(view)).toContain('Olly Owner');
    expect(textOf(view)).toContain('Harbour Homes');
    expect(textOf(view)).toContain('Family-run rentals.');
    expect(textOf(view)).not.toContain('20012345');
  });

  it('opens the profile completion checklist from its row', async () => {
    const view = await render(<OwnerProfilePage />);

    // The owner workspace's only way to /owner/profile/completion (R19).
    expect(getByName(view, 'a', 'Profile Completion').getAttribute('href')).toBe('/owner/profile/completion');
  });

  it('offers a retry instead of empty details when the profile cannot be loaded', async () => {
    mocks.read.mockRejectedValueOnce(new ApiError(0, 'Could not connect. Check your connection and try again.'));
    const view = await render(<OwnerProfilePage />);

    expect(textOf(view)).toContain('Your profile could not be loaded');
    expect(textOf(view)).not.toContain('No phone on file');
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Olly Owner');
  });
});
