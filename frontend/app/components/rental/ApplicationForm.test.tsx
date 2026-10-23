import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Application } from '@/app/lib/api';
import { addDays, sydneyToday, type MyProfile } from '@/app/lib/my-profile';
import type { DocumentChecklist, ProfileDocument } from '@/app/lib/profile-documents';
import { emptyTenant, myProfile } from '@/app/test-utils/my-profile';
import ApplicationForm from './ApplicationForm';

const mockApi = vi.hoisted(() => ({ applications: { create: vi.fn() } }));
const profiles = vi.hoisted(() => ({ getMyProfile: vi.fn() }));
const documents = vi.hoisted(() => ({ checklist: vi.fn() }));

vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));
vi.mock('@/app/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/app/lib/api')>()), api: mockApi }));
vi.mock('@/app/lib/my-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/my-profile')>()),
  getMyProfile: profiles.getMyProfile,
}));
vi.mock('@/app/lib/profile-documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/profile-documents')>()),
  documentsApi: documents,
}));

const TODAY = sydneyToday();
const MOVE_IN = addDays(TODAY, 30);
const LISTING = { id: 'pr-42', title: 'Harbour flat', price: 650 };

function tenantProfile(tenant: Partial<NonNullable<MyProfile['tenant']>> = {}): MyProfile {
  return myProfile({
    tenant: {
      ...emptyTenant(), about_me: 'Nurse at the local hospital.', budget_min: 500, budget_max: 600,
      move_in_date: MOVE_IN, household_size: 2, has_pets: true,
      household: { members: [], pets: 'One indoor cat' }, ...tenant,
    },
  });
}

function doc(over: Partial<ProfileDocument>): ProfileDocument {
  return {
    id: 'doc-1', document_type: 'PASSPORT', label: 'Passport', status: 'verified', rejection_reason: null,
    file_name: 'Passport.pdf', has_file: true, can_open: true, visibility: 'applications', kind: null,
    submitted_at: '2026-10-01T00:00:00Z', verified_at: null, ...over,
  };
}

function checklist(docs: ProfileDocument[]): DocumentChecklist {
  return {
    role: 'tenant', can_share: true, types: [], requirements: [], requirements_met: true,
    account: { status: 'verified', rejection_reason: null, approved_at: null, account_rejected: false }, documents: docs,
  };
}

/** The control a visible <label> names. */
function field(view: FakeElement, text: RegExp): FakeElement {
  const label = descendants(view).find((element) => element.tagName === 'LABEL' && text.test(textOf(element)));
  if (!label) throw new Error(`No label reads ${text}`);
  const target = label.getAttribute('for');
  return (target ? descendants(view).find((element) => element.id === target) : descendants(label).find((element) => element.tagName === 'INPUT')) as FakeElement;
}

/** A control's value; a textarea's first value is its defaultValue, which the test DOM does not copy into value. */
const valueOf = (control: FakeElement) => control.value || (control as FakeElement & { defaultValue?: string }).defaultValue || '';

async function toggle(checkbox: FakeElement) {
  checkbox.checked = !checkbox.checked;
  await click(checkbox);
}

async function submit(view: FakeElement) {
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
}

const sent = () => mockApi.applications.create.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request leaves a test'); }));
  profiles.getMyProfile.mockResolvedValue(tenantProfile());
  documents.checklist.mockResolvedValue(checklist([]));
  mockApi.applications.create.mockResolvedValue({ id: 'app-1', stage: 'submitted' } as Application);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('the apply form', () => {
  it('starts from the saved profile: move-in date, household, pets, budget as the offer and about line', async () => {
    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={vi.fn()} />);

    expect(field(view, /^Move-in date/).value).toBe(MOVE_IN);
    expect(field(view, /^People living there/).value).toBe('2');
    expect(field(view, /^I have pets/).checked).toBe(true);
    expect(field(view, /^About your pets/).value).toBe('One indoor cat');
    // The weekly budget is below the asking rent, so it is the offer.
    expect(field(view, /^Weekly rent you offer/).value).toBe('600');
    expect(valueOf(field(view, /^About you$/))).toBe('Nurse at the local hospital.');
    expect(textOf(view).match(/Filled in from your profile/g)).toHaveLength(6);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('takes an about line as long as the profile keeps, and sends it whole', async () => {
    const long = 'Quiet, tidy and reliable. '.repeat(76).trim();
    profiles.getMyProfile.mockResolvedValue(tenantProfile({ about_me: long }));
    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={vi.fn()} />);

    expect(field(view, /^About you$/).getAttribute('maxLength')).toBe('2000');
    await submit(view);
    expect(sent().about).toBe(long);
  });

  it('offers the asking rent when the budget reaches it, and leaves out a move-in date that has passed', async () => {
    profiles.getMyProfile.mockResolvedValue(tenantProfile({ budget_max: 900, move_in_date: addDays(TODAY, -3) }));

    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={vi.fn()} />);

    expect(field(view, /^Weekly rent you offer/).value).toBe('650');
    expect(field(view, /^Move-in date/).value).toBe('');
  });

  it('sends what the tenant changed, not what the profile said', async () => {
    const onSubmitted = vi.fn();
    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={onSubmitted} />);

    await typeInto(field(view, /^Weekly rent you offer/), '620');
    await typeInto(field(view, /^People living there/), '3');
    await toggle(field(view, /^I have pets/));
    await typeInto(field(view, /^About you$/), '  Quiet couple.  ');
    await typeInto(field(view, /^Message to the landlord/), 'Can we inspect on Saturday?');
    await submit(view);

    expect(sent()).toEqual({
      property_id: 'pr-42', move_in_date: MOVE_IN, occupants: 3, has_pets: false, pets: null, rent_offered: 620,
      about: 'Quiet couple.', annual_income: null, message: 'Can we inspect on Saturday?', document_ids: [],
    });
    expect(onSubmitted).toHaveBeenCalledWith({ id: 'app-1', stage: 'submitted' });
  });

  it('starts empty when the profile cannot be read, and still sends', async () => {
    profiles.getMyProfile.mockRejectedValue(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));

    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={vi.fn()} />);

    expect(textOf(view)).toContain("Your saved profile couldn't be loaded, so nothing is filled in for you.");
    expect(field(view, /^People living there/).value).toBe('');
    await submit(view);
    expect(sent()).toMatchObject({ rent_offered: 650, occupants: null, has_pets: false, move_in_date: null });
  });

  it('lists only the documents the tenant marked shareable, and sends the ones ticked', async () => {
    documents.checklist.mockResolvedValue(checklist([
      doc({ id: 'passport', label: 'Passport' }),
      doc({ id: 'payslip', label: 'Payslip', status: 'pending' }),
      doc({ id: 'licence', label: 'Driver licence', visibility: 'private' }),
      doc({ id: 'statement', label: 'Bank statement', has_file: false }),
      doc({ id: 'mobile', label: 'Medicare card', can_open: false }),
    ]));
    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={vi.fn()} />);

    const offered = descendants(view).filter((element) => element.tagName === 'INPUT' && element.type === 'checkbox')
      .map((box) => textOf(box.parentElement as FakeElement));
    expect(offered).toEqual(['I have pets', 'Passport · Verified by TenantVoice', 'Payslip · In review']);
    await toggle(field(view, /^Payslip/));
    await submit(view);

    expect(sent().document_ids).toEqual(['payslip']);
  });

  it('points a tenant with nothing shared to where they choose what to share', async () => {
    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={vi.fn()} />);

    expect(textOf(view)).toContain("You haven't chosen any documents to share with landlords.");
    expect(getByName(view, 'a', 'Choose documents to share').getAttribute('href')).toBe('/tenant/id-verification');
  });

  it('says so when the documents cannot be read, and still applies', async () => {
    documents.checklist.mockRejectedValue(new ApiError(503, 'down'));

    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={vi.fn()} />);

    expect(textOf(view)).toContain("Your documents couldn't be loaded. You can still apply without them.");
    await submit(view);
    expect(mockApi.applications.create).toHaveBeenCalledTimes(1);
  });

  it('opens the form even when a read gives nothing it can use', async () => {
    profiles.getMyProfile.mockResolvedValue(null);
    documents.checklist.mockResolvedValue({});

    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={vi.fn()} />);

    expect(textOf(view)).toContain("Your saved profile couldn't be loaded, so nothing is filled in for you.");
    expect(textOf(view)).toContain("Your documents couldn't be loaded. You can still apply without them.");
    expect(field(view, /^Weekly rent you offer/).value).toBe('650');
  });

  it('stops a value the server would refuse before sending it', async () => {
    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={vi.fn()} />);

    await typeInto(field(view, /^People living there/), '0');
    await submit(view);

    expect(mockApi.applications.create).not.toHaveBeenCalled();
    expect(textOf(descendants(view).find((element) => element.getAttribute('role') === 'alert') as FakeElement))
      .toBe('Enter how many people will live there, from 1 to 20.');
  });

  it("shows the server's answer when the application is refused, and keeps what was typed", async () => {
    mockApi.applications.create.mockRejectedValue(new ApiError(409, 'You have already applied to this property'));
    const onSubmitted = vi.fn();
    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={onSubmitted} />);

    await typeInto(field(view, /^Message to the landlord/), 'Hello');
    await submit(view);

    expect(textOf(view)).toContain('You have already applied to this property');
    expect(field(view, /^Message to the landlord/).value).toBe('Hello');
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('says why an unverified tenant cannot apply yet, with the way to their documents', async () => {
    const message = 'Your account needs to be verified before you can apply for rentals. Upload the documents it asks for, or wait for the review to finish.';
    mockApi.applications.create.mockRejectedValue(new ApiError(403, message, {
      code: 'verification_required', action: 'apply', status: 'pending', message, documents_href: '/tenant/id-verification',
    }));
    const onSubmitted = vi.fn();
    const view = await render(<ApplicationForm listing={LISTING} onSubmitted={onSubmitted} />);

    await submit(view);

    const alerts = descendants(view).filter((element) => element.getAttribute('role') === 'alert');
    expect(alerts.map(textOf)).toEqual([`Verification needed${message}Go to your documents`, '']);
    expect(getByName(view, 'a', 'Go to your documents').getAttribute('href')).toBe('/tenant/id-verification');
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(lowContrastText(view)).toEqual([]);

    // A later failure of another kind replaces it.
    mockApi.applications.create.mockRejectedValue(new ApiError(409, 'You have already applied to this property'));
    await submit(view);
    expect(textOf(view)).not.toContain('Verification needed');
    expect(textOf(view)).toContain('You have already applied to this property');
  });
});
