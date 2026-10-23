import { cleanup, click, descendants, dispatch, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyProfile, MyProfileUpdate } from '@/app/lib/my-profile';
import { myProfile, profileServer } from '@/app/test-utils/my-profile';
import ProfileSettingsForm, { type SettingsRole } from './ProfileSettingsForm';

const mocks = vi.hoisted(() => ({ save: vi.fn<(patch: MyProfileUpdate) => Promise<MyProfile>>() }));
vi.mock('@/app/lib/my-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/my-profile')>()),
  updateMyProfile: mocks.save,
}));

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

/** The checkbox of the switch whose label starts with name. */
function box(view: FakeElement, name: string): FakeElement {
  const label = descendants(view).find((element) => element.tagName === 'LABEL' && textOf(element).startsWith(name));
  const id = label?.getAttribute('for');
  const control = descendants(view).find((element) => element.id === id);
  if (!control) throw new Error(`No switch ${name}`);
  return control;
}

function labels(view: FakeElement): string[] {
  return descendants(view).filter((element) => element.tagName === 'LABEL')
    .map((element) => textOf(descendants(element).find((child) => child.tagName === 'SPAN') as FakeElement));
}

async function toggle(view: FakeElement, name: string) {
  const control = box(view, name);
  control.checked = !control.checked;
  await click(control);
}

async function save(view: FakeElement) {
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
}

function show(profile: MyProfile, role: SettingsRole = 'tenant') {
  const server = profileServer(profile);
  mocks.save.mockImplementation(server.save);
  return render(<div className="bg-white"><ProfileSettingsForm role={role} profile={profile} onSaved={() => {}} /></div>);
}

const ALL_ON = {
  push_enabled: true, matches: true, application: true, message: true, repairs: true, property: true, booking: true,
  review: true, profile_updates: true,
};
const TENANT_PRIVACY = {
  public_profile: true, discoverable: true, show_availability: true, allow_messages: true, show_contact: false,
  share_score: true,
};

describe('ProfileSettingsForm notifications', () => {
  it.each(['tenant', 'landlord', 'service_provider'] as const)(
    'tells a %s the switches hold in both apps and stop new notices', async (role) => {
      const view = await show(myProfile({}, { landlord: role === 'landlord' }), role);

      expect(textOf(view)).toContain('Saved to your account, for the website and the TenantVoice app.');
      // Some of the app's own functions (mobile_start_conversation, update_maintenance_work_order, ...)
      // write notices without reading the switches.
      expect(textOf(view)).toContain('A kind you switch off sends you no new notices from the website; some notices '
        + "from the TenantVoice app's own features, such as its messages and repair updates, still arrive.");
      expect(textOf(view)).toContain('Off: the website sends only account alerts');
      expect(lowContrastText(view)).toEqual([]);
    },
  );

  it("tells a provider that hiding their profile also hides them from owners' provider search in the app", async () => {
    const view = await show(myProfile(), 'service_provider');

    expect(textOf(view)).toContain("Off also hides you from owners' provider search and suggestions in the TenantVoice app.");
    expect(textOf(view)).toContain("In the TenantVoice app, owners' provider search and suggestions leave you out too.");
  });

  it('shows each role the notices it gets, in its own words', async () => {
    const tenant = await show(myProfile());
    expect(labels(tenant).slice(0, 10)).toEqual([
      'All notifications', 'Property matches', 'Application updates', 'New messages', 'Repairs', 'Complaint updates',
      'Service bookings', 'Reviews', 'Profile updates', 'Account alerts',
    ]);
    cleanup();

    const provider = await show(myProfile(), 'service_provider');
    expect(labels(provider).slice(0, 8)).toEqual([
      'All notifications', 'Bookings', 'New messages', 'Repair jobs', 'Reviews', 'Complaint updates', 'Profile updates',
      'Account alerts',
    ]);
    expect(labels(provider)).not.toContain('Property matches');
  });

  it.each([
    ['tenant', 'Replies to reviews you wrote, and answers to your scorecard requests.'],
    ['landlord', 'New reviews of your properties, replies, and tenants asking for a scorecard.'],
  ] as const)('tells a %s the Reviews switch covers scorecard notices too', async (role, hint) => {
    // A scorecard request and its answer are review notices (backend services/scorecards.py NOTICE_KIND).
    const view = await show(myProfile({}, { landlord: role === 'landlord' }), role);

    const label = descendants(view).find((element) => element.tagName === 'LABEL' && textOf(element).startsWith('Reviews'))!;
    expect(textOf(label.parentElement as FakeElement)).toContain(hint);
  });

  it("says the readiness score switch shows the owner scorecards' average on the public profile", async () => {
    const view = await show(myProfile());

    const label = descendants(view).find((element) => element.tagName === 'LABEL' && textOf(element).startsWith('Share my readiness score'))!;
    expect(textOf(label.parentElement as FakeElement)).toContain(
      'Shows the average of the owner scorecards you choose on your public profile, to everyone who can see it.');
    expect(textOf(view)).not.toContain('once scorecards can be shared');
  });

  it('keeps account alerts on: no switch stops them', async () => {
    const profile = myProfile();
    profile.settings.notification_preferences.account = false;
    const view = await show(profile);

    const account = box(view, 'Account alerts');
    expect(account.checked).toBe(true);
    expect(account.hasAttribute('disabled')).toBe(true);
    expect(textOf(view)).toContain('Verification, account and security notices. These always arrive.');
  });

  it('saves a kind switched off, with the switches the role has', async () => {
    const view = await show(myProfile());
    await toggle(view, 'Property matches');
    await save(view);

    expect(mocks.save).toHaveBeenCalledWith({
      settings: { notification_preferences: { ...ALL_ON, matches: false }, privacy: TENANT_PRIVACY },
    });
  });

  it('turns every notice off with one switch, keeping the others as they were', async () => {
    const profile = myProfile();
    profile.settings.notification_preferences.review = false;
    const view = await show(profile);
    await toggle(view, 'All notifications');

    expect(box(view, 'Property matches').hasAttribute('disabled')).toBe(true);
    expect(box(view, 'Property matches').checked).toBe(true);
    expect(box(view, 'Account alerts').checked).toBe(true);
    await save(view);

    expect(mocks.save).toHaveBeenCalledWith({
      settings: { notification_preferences: { ...ALL_ON, push_enabled: false, review: false }, privacy: TENANT_PRIVACY },
    });
  });

  it('reads a switch the response leaves out as on', async () => {
    const profile = myProfile();
    delete profile.settings.notification_preferences.repairs;
    const view = await show(profile);

    expect(box(view, 'Repairs').checked).toBe(true);
  });
});

describe('ProfileSettingsForm privacy', () => {
  it('names the switches only the mobile app acts on as the app\'s', async () => {
    const view = await show(myProfile());

    expect(textOf(view)).toContain('Members see them on your profile in the TenantVoice app. The website never shows them.');
    expect(textOf(view)).toContain('Members can start a conversation with you in the TenantVoice app.');
    expect(box(view, 'Show my email and phone in the app').checked).toBe(false);
  });

  it('keeps contact details hidden when the response holds no switch for them', async () => {
    const profile = myProfile();
    delete profile.settings.privacy.show_contact;
    delete profile.settings.privacy.discoverable;
    const view = await show(profile);

    expect(box(view, 'Show my email and phone in the app').checked).toBe(false);
    expect(box(view, 'Let people find me in searches').checked).toBe(true);
  });

  it('saves the switches a landlord has, and no tenant ones', async () => {
    const view = await show(myProfile({}, { landlord: true }), 'landlord');
    await toggle(view, 'Let people find me in searches');
    await save(view);

    const patch = mocks.save.mock.calls[0][0];
    expect(patch.settings?.privacy).toEqual({
      public_profile: true, discoverable: false, allow_messages: true, show_contact: false,
    });
    expect(patch.settings?.notification_preferences).not.toHaveProperty('matches');
  });
});
