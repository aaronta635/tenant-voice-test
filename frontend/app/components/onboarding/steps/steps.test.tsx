import { cleanup, click, dispatch, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { createRef, type ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepHandle, StepProps } from '@/app/components/onboarding/step-types';
import { addDays, sydneyToday, type MyProfile, type RentalHistoryEntry, type TenantDetails } from '@/app/lib/my-profile';
import { emptyTenant, myProfile } from '@/app/test-utils/my-profile';
import { button, field, tick } from '@/app/test-utils/onboarding';
import AboutStep, { wordCount } from './AboutStep';
import BusinessStep from './BusinessStep';
import EmergencyStep from './EmergencyStep';
import HistoryStep from './HistoryStep';
import HouseholdStep from './HouseholdStep';
import LocationsStep from './LocationsStep';
import PersonalStep from './PersonalStep';
import PropertyStep from './PropertyStep';
import PublishStep from './PublishStep';

vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

afterEach(cleanup);

const ENTRY: RentalHistoryEntry = {
  id: 'mobile-7', address: '3/88 Pacific Hwy', suburb: 'North Sydney', state: 'NSW', start_date: '2020-01-01',
  end_date: '2022-06-30', current: false, weekly_rent: 600, landlord_name: 'Sarah Jones', landlord_contact: null,
  reason_for_leaving: null, bond_returned: 'yes',
};

function tenantProfile(tenant: Partial<TenantDetails> = {}): MyProfile {
  return myProfile({ id: 'e1000000-0000-4000-8000-000000000001', tenant: { ...emptyTenant(), ...tenant } });
}

/** A step on its own, and its answers as the wizard reads them when the member moves on. */
async function step(Step: ComponentType<StepProps>, profile: MyProfile) {
  const handle = createRef<StepHandle>();
  const view = await render(<Step profile={profile} handle={handle} />);
  return { view, answers: () => handle.current!.answers() };
}

async function choose(select: FakeElement, value: string) {
  select.value = value;
  await dispatch(select, 'change');
}

const focused = () => document.activeElement as unknown as FakeElement;

/** Presses a control as a keyboard user does, and waits for the focus the step hands on. */
async function press(control: FakeElement) {
  control.focus();
  await click(control);
  await new Promise((done) => setTimeout(done, 0));
  await settle();
}

describe('focus in the steps', () => {
  it('stays on the suburb field after Add, and moves to the next suburb after a Remove', async () => {
    const { view } = await step(LocationsStep, tenantProfile({ preferred_locations: ['Newtown', 'Glebe'] }));

    await typeInto(field(view, 'Suburb or postcode'), 'Marrickville');
    await press(button(view, 'Add'));
    expect(focused().id).toBe('onboarding-place');

    await press(button(view, 'Remove Newtown'));
    expect(focused().getAttribute('aria-label')).toBe('Remove Glebe');
    await press(button(view, 'Remove Glebe'));
    await press(button(view, 'Remove Marrickville'));
    expect(focused().id).toBe('onboarding-place');
  });

  it('moves to a new person\'s name, and after a Remove to the next person or the add button', async () => {
    const { view } = await step(HouseholdStep, tenantProfile());

    await press(button(view, '+ Add another person'));
    expect(focused().id).toBe('onboarding-member-0-name');
    await press(button(view, '+ Add another person'));
    expect(focused().id).toBe('onboarding-member-1-name');

    await press(button(view, 'Remove person 1'));
    expect(focused().id).toBe('onboarding-member-0-name');
    await press(button(view, 'Remove person 1'));
    expect(textOf(focused())).toBe('+ Add another person');
  });

  it('opens the address form at its first field, and returns to the list when it closes', async () => {
    const { view } = await step(HistoryStep, tenantProfile({ rental_history: [ENTRY] }));

    await press(button(view, '+ Add address'));
    expect(focused().id).toBe('onboarding-history-address');
    await press(button(view, 'Cancel'));
    expect(textOf(focused())).toBe('+ Add address');

    await press(button(view, '+ Add address'));
    await typeInto(field(view, 'Street address'), '7 King Street');
    await press(button(view, 'Add address'));
    expect(focused().id).toBe('onboarding-history-edit-1');

    await press(button(view, 'Edit 3/88 Pacific Hwy'));
    expect(focused().id).toBe('onboarding-history-address');
    await press(button(view, 'Update address'));
    expect(focused().id).toBe('onboarding-history-edit-0');

    await press(button(view, 'Remove 3/88 Pacific Hwy'));
    expect(focused().id).toBe('onboarding-history-edit-0');
    await press(button(view, 'Remove 7 King Street'));
    expect(textOf(focused())).toBe('+ Add address');
  });
});

describe('every step', () => {
  it.each([
    ['personal details', PersonalStep, tenantProfile()],
    ['household', HouseholdStep, tenantProfile()],
    ['suburbs', LocationsStep, tenantProfile({ preferred_locations: ['Newtown'] })],
    ['property preferences', PropertyStep, tenantProfile()],
    ['introduction', AboutStep, tenantProfile({ about_me: 'Hello there' })],
    ['rental history', HistoryStep, tenantProfile({ rental_history: [ENTRY] })],
    ['emergency contact', EmergencyStep, tenantProfile()],
    ['business', BusinessStep, myProfile({}, { landlord: true })],
    ['visibility', PublishStep, tenantProfile()],
  ])('saves nothing when the %s step is left as it was', async (_name, Step, profile) => {
    const { answers } = await step(Step, profile);
    expect(answers()).toBeNull();
  });
});

describe('the personal step', () => {
  it('sends only the fields that changed', async () => {
    const { view, answers } = await step(PersonalStep, tenantProfile());
    await typeInto(field(view, 'State'), 'VIC');
    expect(answers()).toEqual({ patch: { state: 'VIC' } });
  });

  it('checks a changed phone number, not one stored in another format', async () => {
    const stored = await step(PersonalStep, myProfile({ phone: '0412.345.678' }));
    await typeInto(field(stored.view, 'Suburb you live in'), 'Glebe');
    expect(stored.answers()).toEqual({ patch: { location: 'Glebe' } });

    await typeInto(field(stored.view, 'Phone'), '12');
    expect(stored.answers()).toEqual({ problem: 'Enter a phone number of 6 to 15 digits.', field: 'onboarding-phone' });
  });
});

describe('the household step', () => {
  it('needs a name for each person and a whole-number age', async () => {
    const { view, answers } = await step(HouseholdStep, tenantProfile());
    await click(button(view, '+ Add another person'));
    await typeInto(field(view, 'Age (optional)'), '31');
    expect(answers()).toMatchObject({ problem: 'Give each person a name, or remove them.', field: 'onboarding-member-0-name' });

    await typeInto(field(view, 'Full name'), 'Sam');
    await typeInto(field(view, 'Age (optional)'), '3.5');
    expect(answers()).toMatchObject({ problem: "Enter Sam's age in whole years." });

    await click(button(view, 'Remove person 1'));
    expect(answers()).toBeNull();
  });

  it('asks about pets once the box is ticked, and clears them when it is unticked', async () => {
    const { view, answers } = await step(HouseholdStep, tenantProfile({ has_pets: true, household: { members: [], pets: 'A cat' } }));
    expect(field(view, 'About your pets').value).toBe('A cat');

    await tick(view, 'Pets will live with us');
    expect(answers()).toEqual({ patch: { tenant: { has_pets: false, household: { pets: null } } } });
  });
});

describe('the suburbs step', () => {
  it('ignores a suburb already added, whatever its case, and removes one on request', async () => {
    const { view, answers } = await step(LocationsStep, tenantProfile({ preferred_locations: ['Newtown'] }));
    await typeInto(field(view, 'Suburb or postcode'), ' newtown ');
    await click(button(view, 'Add'));
    expect(answers()).toBeNull();
    expect(textOf(view)).toContain('Add at least 3 suburbs for better matches.');

    await typeInto(field(view, 'Suburb or postcode'), 'Glebe');
    await click(button(view, 'Add'));
    await click(button(view, 'Remove Newtown'));
    expect(answers()).toEqual({ patch: { tenant: { preferred_locations: ['Glebe'] } } });
  });

  it('stops at ten suburbs, as the server does', async () => {
    const places = Array.from({ length: 10 }, (_, index) => `Suburb ${index + 1}`);
    const { view } = await step(LocationsStep, tenantProfile({ preferred_locations: places }));
    expect(field(view, 'Suburb or postcode').hasAttribute('disabled')).toBe(true);
    expect(textOf(view)).toContain('You have added the most suburbs you can, 10.');
  });
});

describe('the property step', () => {
  it('keeps a stored count the options do not offer, and sends a change as a number', async () => {
    const tenant = { ...emptyTenant().rental_preferences, bedrooms_min: 5 };
    const { view, answers } = await step(PropertyStep, tenantProfile({ rental_preferences: tenant }));
    expect(field(view, 'Bedrooms (at least)').value).toBe('5');
    expect(answers()).toBeNull();

    await choose(field(view, 'Car spaces (at least)'), '1');
    await choose(field(view, 'Bedrooms (at least)'), '');
    expect(answers()).toEqual({ patch: { tenant: { rental_preferences: { bedrooms_min: null, parking_min: 1 } } } });
  });
});

describe('the introduction step', () => {
  it('counts words and asks for fifty', async () => {
    const { view } = await step(AboutStep, tenantProfile());
    await typeInto(field(view, 'About you'), 'Quiet, tidy and reliable.');
    expect(textOf(view)).toContain('4 words · Aim for 50 words or more for the best impression.');
    expect(wordCount('  one  two\nthree ')).toBe(3);
  });

  it('saves a landlord\'s bio, and a cleared one as nothing', async () => {
    const landlord = myProfile({}, { landlord: true });
    const { view, answers } = await step(AboutStep, { ...landlord, landlord: { ...landlord.landlord!, bio: 'Old bio' } });
    await typeInto(field(view, 'About you and your rentals'), '   ');
    expect(answers()).toEqual({ patch: { landlord: { bio: null } } });
  });
});

describe('the rental history step', () => {
  it('keeps the id of an entry it changes, so the server keeps what other apps added to it', async () => {
    const { view, answers } = await step(HistoryStep, tenantProfile({ rental_history: [ENTRY] }));
    await click(button(view, 'Edit 3/88 Pacific Hwy'));
    await typeInto(field(view, 'Weekly rent ($)'), '620');
    await click(button(view, 'Update address'));

    expect(answers()).toEqual({ patch: { tenant: { rental_history: [{ ...ENTRY, weekly_rent: 620 }] } } });
  });

  it('includes an address still open in the form, once it passes the checks', async () => {
    const { view, answers } = await step(HistoryStep, tenantProfile());
    await click(button(view, '+ Add address'));
    await typeInto(field(view, 'Suburb'), 'Newtown');
    expect(answers()).toEqual({ problem: 'Enter the street address.', field: 'onboarding-history-address' });

    await typeInto(field(view, 'Street address'), '12 King St');
    await typeInto(field(view, 'Lease start'), '2024-05-01');
    await typeInto(field(view, 'Lease end'), '2024-01-01');
    expect(answers()).toMatchObject({ problem: 'A tenancy cannot end before it starts.' });

    await typeInto(field(view, 'Lease end'), addDays(sydneyToday(), 3));
    expect(answers()).toMatchObject({ field: 'onboarding-history-end' });

    await typeInto(field(view, 'Lease end'), '');
    await tick(view, 'This is my current address');
    expect(answers()).toEqual({ patch: { tenant: { rental_history: [expect.objectContaining({
      address: '12 King St', suburb: 'Newtown', start_date: '2024-05-01', end_date: null, current: true,
    })] } } });
  });

  it('shows a problem in the form and keeps it open when an address is added', async () => {
    const { view } = await step(HistoryStep, tenantProfile());
    await click(button(view, '+ Add address'));
    await typeInto(field(view, 'Weekly rent ($)'), '99999');
    await typeInto(field(view, 'Street address'), '1 Main St');
    await click(button(view, 'Add address'));

    expect(textOf(view)).toContain('Enter the weekly rent from $0 to $20,000.');
    expect(document.activeElement?.id).toBe('onboarding-history-rent');
  });

  it('removes an entry', async () => {
    const { view, answers } = await step(HistoryStep, tenantProfile({ rental_history: [ENTRY] }));
    await click(button(view, 'Remove 3/88 Pacific Hwy'));
    expect(answers()).toEqual({ patch: { tenant: { rental_history: [] } } });
  });
});

describe('the emergency contact step', () => {
  it('needs a way to reach a named contact, and a name for a number', async () => {
    const { view, answers } = await step(EmergencyStep, tenantProfile());
    await typeInto(field(view, 'Full name'), 'Ines Lin');
    expect(answers()).toMatchObject({ problem: 'Add a phone number or email for your emergency contact.' });

    await typeInto(field(view, 'Full name'), '');
    await typeInto(field(view, 'Email'), 'ines@example.test');
    expect(answers()).toMatchObject({ problem: "Add your emergency contact's name." });

    await typeInto(field(view, 'Email'), 'ines@');
    expect(answers()).toMatchObject({ problem: "Enter your emergency contact's email address." });
  });
});

describe('the business step', () => {
  it('needs a whole number of properties', async () => {
    const { view, answers } = await step(BusinessStep, myProfile({}, { landlord: true }));
    await typeInto(field(view, 'Properties you rent out'), '2.5');
    expect(answers()).toMatchObject({ problem: 'Enter how many properties you rent out, as a whole number.' });
  });
});

describe('the visibility step', () => {
  it('saves a member\'s choice to show the profile again', async () => {
    const hidden = tenantProfile();
    hidden.settings = { ...hidden.settings, privacy: { public_profile: false, share_score: true } };
    const { view, answers } = await step(PublishStep, hidden);
    expect(textOf(view)).toContain('You stay out of profile search');

    await tick(view, 'Show my profile in profile search');
    expect(textOf(view)).toContain('the suburbs you want');
    expect(answers()).toEqual({ patch: { settings: { privacy: { public_profile: true } } } });
  });
});
