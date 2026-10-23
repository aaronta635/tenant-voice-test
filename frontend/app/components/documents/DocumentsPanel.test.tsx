import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { DocumentChecklist, ProfileDocument } from '@/app/lib/profile-documents';
import DocumentsPanel from './DocumentsPanel';

const mockDocuments = vi.hoisted(() => ({
  checklist: vi.fn(), upload: vi.fn(), replaceFile: vi.fn(), update: vi.fn(), remove: vi.fn(), link: vi.fn(),
}));
vi.mock('@/app/lib/profile-documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/profile-documents')>()),
  documentsApi: mockDocuments,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const KINDS: DocumentChecklist['types'][number]['kinds'] = [
  { value: 'payslip', label: 'Payslip' }, { value: 'employment_contract', label: 'Employment contract' },
];
const TYPES: DocumentChecklist['types'] = [
  { type: 'PASSPORT', label: 'Passport', description: 'A current passport.', group: 'identity', group_label: 'Identity', repeatable: false, required: true, kinds: [] },
  { type: 'DRIVERS_LICENCE', label: 'Driver licence', description: 'A current licence.', group: 'identity', group_label: 'Identity', repeatable: false, required: true, kinds: [] },
  { type: 'BANK_STATEMENT', label: 'Bank statement', description: 'A recent statement.', group: 'financial', group_label: 'Financial', repeatable: false, required: false, kinds: [] },
  { type: 'OTHER', label: 'Other document (for example a payslip or contract)', description: 'Anything else.', group: 'other', group_label: 'Other', repeatable: false, required: false, kinds: KINDS },
];

function checklist(documents: ProfileDocument[] = [], over: Partial<DocumentChecklist> = {}): DocumentChecklist {
  return {
    role: 'tenant',
    can_share: true,
    types: TYPES,
    requirements: [
      { key: 'passport', label: 'Passport', types: ['PASSPORT'], status: 'missing' },
      { key: 'drivers_licence', label: 'Driver licence', types: ['DRIVERS_LICENCE'], status: 'missing' },
    ],
    requirements_met: false,
    account: { status: 'pending', rejection_reason: null, approved_at: null, account_rejected: false },
    documents,
    ...over,
  };
}

function saved(over: Partial<ProfileDocument> = {}): ProfileDocument {
  return {
    id: 'doc-1', document_type: 'PASSPORT', label: 'Passport', status: 'pending', rejection_reason: null,
    file_name: 'Passport.pdf', has_file: true, can_open: true, visibility: 'private', kind: null,
    submitted_at: '2026-10-20T01:00:00Z', verified_at: null, ...over,
  };
}

const pdf = (name = 'Passport.pdf', bytes = 10) => new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
const card = (view: FakeElement, title: string) =>
  descendants(view).find((element) => element.getAttribute('role') === 'group' && textOf(element).startsWith(title)) as FakeElement;

/** The control a visible <label> names, as the Input component links them (htmlFor). */
function labelled(view: FakeElement, text: RegExp) {
  const label = descendants(view).find((element) => element.tagName === 'LABEL' && text.test(textOf(element))) as FakeElement;
  const control = label.getAttribute('for')
    ? descendants(view).find((element) => element.id === label.getAttribute('for'))
    : descendants(label).find((element) => element.tagName === 'INPUT');
  return control as FakeElement;
}

async function choose(view: FakeElement, inputName: string, file: File) {
  const input = getByName(view, 'input', inputName);
  input.files = [file];
  await dispatch(input, 'change');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockDocuments.checklist.mockResolvedValue(checklist());
});
afterEach(cleanup);

describe('loading the documents', () => {
  it('says it is loading, then lists every type of the role as not uploaded', async () => {
    const pending = deferred<DocumentChecklist>();
    mockDocuments.checklist.mockReturnValue(pending.promise);
    const view = await render(<DocumentsPanel />);
    expect(textOf(view)).toContain('Loading your documents…');

    pending.resolve(checklist());
    await settle();

    expect(textOf(view)).not.toContain('Loading your documents…');
    for (const heading of ['Identity', 'Financial', 'Other', 'What verification needs', 'Your documents are private']) {
      expect(textOf(view)).toContain(heading);
    }
    expect(textOf(card(view, 'Passport'))).toContain('Not uploaded');
    expect(textOf(view)).toContain('You have not uploaded any documents yet.');
    // Each requirement is one document, as the shared review_profile_document counts them.
    expect(textOf(view)).toContain('Your account is verified once every document below is.');
    expect(textOf(view)).not.toContain('One verified document of each kind');
  });

  it('names what meets a requirement only when that adds something', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([], {
      types: [
        ...TYPES,
        { type: 'PROOF_OF_PROPERTY_OWNERSHIP', label: 'Proof of ownership', description: 'A rates notice.', group: 'property', group_label: 'Property', repeatable: false, required: true, kinds: [] },
        { type: 'PROPERTY_MANAGEMENT_AUTHORITY', label: 'Management authority', description: 'An agency agreement.', group: 'property', group_label: 'Property', repeatable: false, required: true, kinds: [] },
      ],
      requirements: [{
        key: 'property_authority', label: 'Proof of ownership or management authority',
        types: ['PROOF_OF_PROPERTY_OWNERSHIP', 'PROPERTY_MANAGEMENT_AUTHORITY'], status: 'missing',
      }],
    }));
    const view = await render(<DocumentsPanel />);

    expect(textOf(view).split('Proof of ownership or management authority')).toHaveLength(2);
  });

  it('keeps an earlier type the person still holds, saying it no longer counts, with no new upload', async () => {
    const licence = { ...TYPES[1], required: false, kept_only: true };
    mockDocuments.checklist.mockResolvedValue(checklist(
      [saved({ id: 'doc-9', document_type: 'DRIVERS_LICENCE', label: 'Driver licence', file_name: 'licence.pdf' })],
      { role: 'landlord', can_share: false, types: [TYPES[3], licence] },
    ));
    const view = await render(<DocumentsPanel />);

    const kept = card(view, 'Driver licence');
    expect(textOf(kept)).toContain('No longer counts for verification');
    expect(getByName(kept, 'button', 'Replace Driver licence')).toBeTruthy();
    expect(getByName(kept, 'button', 'Delete Driver licence')).toBeTruthy();

    mockDocuments.checklist.mockResolvedValue(checklist([], { role: 'landlord', can_share: false, types: [TYPES[3], licence] }));
    const empty = await render(<DocumentsPanel />);
    expect(descendants(card(empty, 'Driver licence')).some((element) => textOf(element) === 'Upload Driver licence')).toBe(false);
  });

  it('offers a retry when the documents cannot load', async () => {
    mockDocuments.checklist.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<DocumentsPanel />);

    expect(textOf(view)).toContain("Couldn't load your documents");
    expect(textOf(view)).not.toContain('Not uploaded');
    await click(getByName(view, 'button', 'Try again'));

    expect(mockDocuments.checklist).toHaveBeenCalledTimes(2);
    expect(textOf(card(view, 'Passport'))).toContain('Not uploaded');
  });

  it('shows each saved document with its status, file and, when rejected, the reason', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([
      saved(),
      saved({ id: 'doc-2', document_type: 'DRIVERS_LICENCE', label: 'Driver licence', status: 'rejected', rejection_reason: 'The photo is blurred.' }),
      saved({ id: 'doc-3', document_type: 'BANK_STATEMENT', label: 'Bank statement', status: 'verified', verified_at: '2026-10-21T01:00:00Z' }),
    ]));
    const view = await render(<DocumentsPanel />);

    expect(textOf(card(view, 'Passport'))).toContain('In review');
    expect(textOf(card(view, 'Passport'))).toContain('Passport.pdf');
    const licence = card(view, 'Driver licence');
    expect(textOf(licence)).toContain('Rejected');
    expect(textOf(licence)).toContain('The photo is blurred.');
    expect(getByName(licence, 'button', 'Replace Driver licence').className).toContain('bg-primary-strong');
    expect(textOf(card(view, 'Bank statement'))).toContain('Verified');
    expect(textOf(view)).not.toContain('You have not uploaded any documents yet.');
  });

  it('never hides a second document of a type, such as one the mobile app kept', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([
      saved({ id: 'doc-1', file_name: 'Passport 2026.pdf' }),
      saved({ id: 'doc-2', file_name: null, can_open: false, status: 'verified' }),
    ]));
    const view = await render(<DocumentsPanel />);

    const passports = descendants(view).filter((element) => element.getAttribute('role') === 'group' && textOf(element).startsWith('Passport'));
    expect(passports).toHaveLength(2);
    expect(textOf(passports[0])).toContain('Passport 2026.pdf');
    expect(textOf(passports[1])).toContain("This file was not uploaded on the website, so it can't be opened here.");
    expect(descendants(passports[1]).some((element) => element.tagName === 'BUTTON' && textOf(element) === 'View Passport')).toBe(false);
  });

  it('keeps its text and controls at AA contrast, also under the pointer', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([
      saved(), saved({ id: 'doc-2', document_type: 'DRIVERS_LICENCE', label: 'Driver licence', status: 'rejected', rejection_reason: 'Blurred.' }),
    ]));
    const view = await render(<DocumentsPanel />);

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

describe("the account's verification", () => {
  const photoId = (status: 'missing' | 'pending' | 'verified' | 'rejected') => (
    [{ key: 'passport', label: 'Passport', types: ['PASSPORT'], status }]
  );

  it('waits for an admin while documents are missing or in review', async () => {
    const view = await render(<DocumentsPanel />);

    expect(textOf(view)).toContain('Your account Not verified yet');
    expect(textOf(view)).toContain('Your profile shows the verified badge once a TenantVoice admin approves these.');
  });

  it('says the account is verified once it is approved', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved({ status: 'verified', verified_at: '2026-10-22T00:00:00Z' })], {
      requirements: photoId('verified'),
      requirements_met: true,
      account: { status: 'verified', rejection_reason: null, approved_at: '2026-10-22T00:00:00Z', account_rejected: false },
    }));
    const view = await render(<DocumentsPanel />);

    expect(textOf(view)).toContain('Your account Verified');
    expect(textOf(view)).toContain('Your account is verified, so your profile shows the verified badge.');
  });

  it('shows the decision and its reason on a rejected document, with Replace', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved({ status: 'rejected', rejection_reason: 'The photo is blurred.' })], {
      requirements: photoId('rejected'),
      account: { status: 'rejected', rejection_reason: 'Photo ID: The photo is blurred.', approved_at: null, account_rejected: false },
    }));
    const view = await render(<DocumentsPanel />);

    expect(textOf(view)).toContain('Your account Not verified');
    expect(textOf(view)).toContain('Your account is not verified. Reason: Photo ID: The photo is blurred.');
    expect(textOf(view)).toContain('Replace the documents marked Rejected to send them for review again.');
    const passport = card(view, 'Passport');
    expect(textOf(passport)).toContain('Not accepted: The photo is blurred.');
    expect(getByName(passport, 'button', 'Replace Passport').className).toContain('bg-primary-strong');
  });

  it('says when an admin rejected the account itself, and how to ask again', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved({ status: 'verified' })], {
      requirements: photoId('verified'),
      requirements_met: true,
      account: {
        status: 'rejected', rejection_reason: 'The names on your documents do not match.', approved_at: null, account_rejected: true,
      },
    }));
    const view = await render(<DocumentsPanel />);

    expect(textOf(view)).toContain('TenantVoice did not verify your account. Reason: The names on your documents do not match.');
    expect(textOf(view)).toContain('Replace a document verification needs to ask for another review.');
  });

  it('keeps a rejected account at AA contrast, also under the pointer', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved({ status: 'rejected', rejection_reason: 'Blurred.' })], {
      requirements: photoId('rejected'),
      account: { status: 'rejected', rejection_reason: 'Photo ID: Blurred.', approved_at: null, account_rejected: false },
    }));
    const view = await render(<DocumentsPanel />);

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});

describe('uploading', () => {
  it('shows a document as in review only once the server saved it', async () => {
    const upload = deferred<ProfileDocument>();
    mockDocuments.upload.mockReturnValue(upload.promise);
    const view = await render(<DocumentsPanel />);

    await choose(view, 'File for Passport', pdf());
    expect(mockDocuments.upload).toHaveBeenCalledWith('PASSPORT', expect.any(File), { label: undefined });
    expect(textOf(card(view, 'Passport'))).toContain('Not uploaded');
    expect(getByName(view, 'button', 'Uploading… Passport').getAttribute('aria-disabled')).toBe('true');

    mockDocuments.checklist.mockResolvedValue(checklist([saved()]));
    upload.resolve(saved());
    await settle();

    const passport = card(view, 'Passport');
    expect(textOf(passport)).toContain('In review');
    expect(textOf(passport)).toContain('Passport: Passport.pdf uploaded. It is in review.');
    expect(getByName(passport, 'button', 'Replace Passport')).toBeTruthy();
  });

  it('never shows a failed upload as uploaded', async () => {
    mockDocuments.upload.mockRejectedValue(new ApiError(502, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<DocumentsPanel />);

    await choose(view, 'File for Passport', pdf());

    const passport = card(view, 'Passport');
    expect(textOf(passport)).toContain('Not uploaded');
    expect(textOf(passport)).toContain('The file was not uploaded. The service is temporarily unavailable. Please try again.');
    expect(textOf(passport)).not.toContain('In review');
    expect(getByName(passport, 'button', 'Upload Passport')).toBeTruthy();
  });

  it('refuses a file the bucket would refuse before sending it', async () => {
    const view = await render(<DocumentsPanel />);

    await choose(view, 'File for Passport', pdf('Huge.pdf', 5 * 1024 * 1024 + 1));

    expect(mockDocuments.upload).not.toHaveBeenCalled();
    expect(textOf(card(view, 'Passport'))).toContain('That file is over 5 MB. Upload a smaller scan or photo. Nothing was uploaded.');
  });

  it('opens the file picker from the Upload button', async () => {
    const view = await render(<DocumentsPanel />);
    const input = getByName(view, 'input', 'File for Passport');
    const picker = vi.fn();
    Object.assign(input, { click: picker });

    await click(getByName(view, 'button', 'Upload Passport'));

    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('names the other document, which is one slot: a saved one is replaced, not added to', async () => {
    const payslip = saved({ id: 'doc-9', document_type: 'OTHER', label: 'Payslip', file_name: 'March.pdf' });
    mockDocuments.upload.mockResolvedValue(payslip);
    const view = await render(<DocumentsPanel />);
    mockDocuments.checklist.mockResolvedValue(checklist([payslip]));
    const name = labelled(view, /^Name this document/);
    name.value = 'Payslip';
    await dispatch(name, 'input');

    await choose(view, 'File for Other document (for example a payslip or contract)', pdf('March.pdf'));

    expect(mockDocuments.upload).toHaveBeenCalledWith('OTHER', expect.any(File), { label: 'Payslip' });
    expect(textOf(card(view, 'Payslip'))).toContain('In review');
    expect(getByName(card(view, 'Payslip'), 'button', 'Replace Payslip')).toBeTruthy();
    expect(descendants(view).some((element) => element.tagName === 'BUTTON'
      && textOf(element).startsWith('Upload Other document'))).toBe(false);
    expect(textOf(view)).toContain('You keep one document of each kind. Uploading another replaces it.');
  });

  it('marks an extra document as a payslip, which the profile completion counts', async () => {
    const payslip = saved({ id: 'doc-9', document_type: 'OTHER', label: 'Payslip', kind: 'payslip', file_name: 'March.pdf' });
    mockDocuments.upload.mockResolvedValue(payslip);
    const view = await render(<DocumentsPanel />);
    const other = card(view, 'Other document');
    expect(getByName(other, 'button', 'Something else').getAttribute('aria-pressed')).toBe('true');

    await click(getByName(other, 'button', 'Payslip'));
    expect(getByName(other, 'button', 'Payslip').getAttribute('aria-pressed')).toBe('true');
    await choose(view, 'File for Other document (for example a payslip or contract)', pdf('March.pdf'));

    expect(mockDocuments.upload).toHaveBeenCalledWith('OTHER', expect.any(File), { label: undefined, kind: 'payslip' });
    expect(mockDocuments.update).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Payslips and employment contracts count toward your profile completion.');
  });

  it('changes what a saved document is marked as', async () => {
    const offer = saved({ id: 'doc-9', document_type: 'OTHER', label: 'Offer letter', file_name: 'Offer.pdf' });
    mockDocuments.checklist.mockResolvedValue(checklist([offer]));
    mockDocuments.update.mockResolvedValue({ ...offer, kind: 'employment_contract' });
    const view = await render(<DocumentsPanel />);
    mockDocuments.checklist.mockResolvedValue(checklist([{ ...offer, kind: 'employment_contract' }]));

    await click(getByName(card(view, 'Offer letter'), 'button', 'Employment contract'));

    expect(mockDocuments.update).toHaveBeenCalledWith('doc-9', { kind: 'employment_contract' });
    expect(textOf(card(view, 'Offer letter'))).toContain('Offer letter is marked as an employment contract.');
    expect(getByName(card(view, 'Offer letter'), 'button', 'Employment contract').getAttribute('aria-pressed')).toBe('true');
  });

  it('offers the marks only on the types the checklist marks', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved()], {
      types: TYPES.map((type) => ({ ...type, kinds: [] })),
    }));
    const view = await render(<DocumentsPanel />);

    expect(textOf(view)).not.toContain('What it is');
    expect(lowContrastText(view)).toEqual([]);
  });
});

describe('replacing, deleting and opening', () => {
  it('sends a replaced rejected document back to review without asking', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved({ status: 'rejected', rejection_reason: 'Expired.' })]));
    mockDocuments.replaceFile.mockResolvedValue(saved({ file_name: 'Passport 2027.pdf' }));
    const view = await render(<DocumentsPanel />);
    mockDocuments.checklist.mockResolvedValue(checklist([saved({ file_name: 'Passport 2027.pdf' })]));

    await choose(view, 'Replacement file for Passport', pdf('Passport 2027.pdf'));

    expect(mockDocuments.replaceFile).toHaveBeenCalledWith('doc-1', expect.any(File));
    const passport = card(view, 'Passport');
    expect(textOf(passport)).toContain('In review');
    expect(textOf(passport)).not.toContain('Expired.');
    expect(textOf(passport)).toContain('Passport 2027.pdf uploaded. It is in review again.');
  });

  it('asks before replacing a verified document', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved({ status: 'verified', verified_at: '2026-10-21T01:00:00Z' })]));
    const view = await render(<DocumentsPanel />);
    const input = getByName(view, 'input', 'Replacement file for Passport');
    const picker = vi.fn();
    Object.assign(input, { click: picker });

    await click(getByName(view, 'button', 'Replace Passport'));
    expect(textOf(view)).toContain('Replace your verified passport?');
    expect(picker).not.toHaveBeenCalled();
    await click(getByName(view, 'button', 'Choose the new file'));

    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('says a document can be replaced or deleted at any time, and what that does to the account', async () => {
    // The shared review events point at a document ON DELETE SET NULL: a reviewed one can go too.
    const view = await render(<DocumentsPanel />);

    expect(textOf(view)).toContain(
      'You can replace or delete a document at any time. Replacing or deleting one your verification needs puts your '
      + 'account back in review.',
    );
    expect(textOf(view)).not.toContain('until an admin has reviewed it');
  });

  it('warns that deleting or replacing a required document puts the account back in review', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([
      saved({ status: 'verified', verified_at: '2026-10-21T01:00:00Z' }),
      saved({ id: 'doc-3', document_type: 'BANK_STATEMENT', label: 'Bank statement' }),
    ]));
    const view = await render(<DocumentsPanel />);

    await click(getByName(view, 'button', 'Replace Passport'));
    expect(textOf(view)).toContain('Your account goes back to review too.');
    await click(getByName(view, 'button', 'Cancel'));
    await click(getByName(view, 'button', 'Delete Passport'));
    expect(textOf(view)).toContain('Your verification needs it, so your account goes back to review');
    await click(getByName(view, 'button', 'Cancel'));
    await click(getByName(view, 'button', 'Delete Bank statement'));
    expect(textOf(view)).toContain('The file is deleted from TenantVoice.');
    expect(textOf(view)).not.toContain('Your verification needs it');
  });

  it('deletes a document after confirming and says so', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved()]));
    mockDocuments.remove.mockResolvedValue(undefined);
    const view = await render(<DocumentsPanel />);

    await click(getByName(view, 'button', 'Delete Passport'));
    expect(mockDocuments.remove).not.toHaveBeenCalled();
    mockDocuments.checklist.mockResolvedValue(checklist());
    await click(getByName(view, 'button', 'Delete document'));

    expect(mockDocuments.remove).toHaveBeenCalledWith('doc-1');
    expect(textOf(card(view, 'Passport'))).toContain('Not uploaded');
    expect(textOf(view)).toContain('Passport deleted.');
  });

  it('keeps a document whose delete failed, with the reason', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved({ status: 'verified' })]));
    mockDocuments.remove.mockRejectedValue(new ApiError(409, "The database keeps this reviewed document, so it can't be removed. Replace its file instead."));
    const view = await render(<DocumentsPanel />);

    await click(getByName(view, 'button', 'Delete Passport'));
    await click(getByName(view, 'button', 'Delete document'));

    const passport = card(view, 'Passport');
    expect(textOf(passport)).toContain('Verified');
    expect(textOf(passport)).toContain("The document was not deleted. The database keeps this reviewed document, so it can't be removed.");
  });

  it('opens a file in a new tab through a freshly signed link', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved()]));
    mockDocuments.link.mockResolvedValue({ url: 'https://storage.example.test/signed/Passport.pdf?token=t1', expires_in: 300 });
    const tab = { opener: {}, closed: false, location: { href: '' }, close: vi.fn() };
    const open = vi.fn(() => tab);
    Object.assign(window, { open });
    const view = await render(<DocumentsPanel />);

    await click(getByName(view, 'button', 'View Passport'));

    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(mockDocuments.link).toHaveBeenCalledWith('doc-1');
    expect(tab.location.href).toBe('https://storage.example.test/signed/Passport.pdf?token=t1');
  });

  it('offers the link itself when the browser blocks the new tab', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved()]));
    mockDocuments.link.mockResolvedValue({ url: 'https://storage.example.test/signed/Passport.pdf?token=t1', expires_in: 300 });
    Object.assign(window, { open: vi.fn(() => null) });
    const view = await render(<DocumentsPanel />);

    await click(getByName(view, 'button', 'View Passport'));

    const link = getByName(view, 'a', 'Open Passport.pdf');
    expect(link.getAttribute('href')).toBe('https://storage.example.test/signed/Passport.pdf?token=t1');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('lets a tenant choose to share a document with the owners they apply to', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved()]));
    mockDocuments.update.mockResolvedValue(saved({ visibility: 'applications' }));
    const view = await render(<DocumentsPanel />);
    expect(getByName(card(view, 'Passport'), 'button', 'Only me and admins').getAttribute('aria-pressed')).toBe('true');

    await click(getByName(card(view, 'Passport'), 'button', 'Also owners I apply to'));

    expect(mockDocuments.update).toHaveBeenCalledWith('doc-1', { visibility: 'applications' });
    expect(textOf(card(view, 'Passport'))).toContain('Passport may be shared with owners you apply to.');
    // Applications carry the chosen documents now (R25), so the card says who opens them, and when.
    expect(textOf(card(view, 'Passport'))).toContain(
      "A shared document goes with an application only when you choose it there. The listing's owner can then open it "
      + 'on the website while the application is open or approved. In the TenantVoice app, that owner can open all of '
      + 'your documents while the application is open or approved, whatever you choose here.',
    );
    expect(textOf(card(view, 'Passport'))).not.toContain('once applications can include them');
  });

  it('tells a tenant that owners they apply to can open their documents in the app', async () => {
    // mobile_profile_documents_select opens an applicant's {users.id} folder to the owners they apply to.
    mockDocuments.checklist.mockResolvedValue(checklist([saved()]));
    const view = await render(<DocumentsPanel />);

    expect(textOf(view)).toContain(
      'In the TenantVoice app, the owner of a listing you have an open or approved application for can open all of '
      + 'your documents.',
    );
    expect(textOf(view)).not.toContain('Only you and TenantVoice admins can open them');
  });

  it('offers no sharing to a role that cannot share', async () => {
    mockDocuments.checklist.mockResolvedValue(checklist([saved()], { can_share: false }));
    const view = await render(<DocumentsPanel />);

    expect(textOf(view)).not.toContain('Who can see it');
    expect(textOf(view)).not.toContain('owners of listings you apply to');
    expect(textOf(view)).not.toContain('In the TenantVoice app');
  });
});

describe('file names the old screens kept in this browser', () => {
  it('are never shown as uploaded: a one-time note, then they are gone', async () => {
    localStorage.setItem('tv_tenant_profile_extras', JSON.stringify({
      passport_name: 'my-passport.jpg', passport_uploaded_at: '2026-09-01T00:00:00Z',
      id_document_name: 'licence.png', emergency_name: 'Sam',
    }));
    const view = await render(<DocumentsPanel legacyPicks="tenant" />);

    expect(textOf(view)).toContain('Files you picked before were not uploaded');
    expect(textOf(view)).toContain('my-passport.jpg, licence.png');
    expect(textOf(card(view, 'Passport'))).toContain('Not uploaded');
    expect(textOf(card(view, 'Passport'))).not.toContain('my-passport.jpg');
    // Only the file names go; the rest of the profile extras stay.
    expect(JSON.parse(localStorage.getItem('tv_tenant_profile_extras') as string)).toEqual({ emergency_name: 'Sam' });

    await cleanup();
    const again = await render(<DocumentsPanel legacyPicks="tenant" />);
    expect(textOf(again)).not.toContain('Files you picked before were not uploaded');
  });

  it('clears the owner page\'s file name too', async () => {
    localStorage.setItem('tv_owner_identity_document', 'rates-notice.pdf');
    const view = await render(<DocumentsPanel legacyPicks="landlord" />);

    expect(textOf(view)).toContain('rates-notice.pdf');
    expect(localStorage.getItem('tv_owner_identity_document')).toBeNull();
    await click(getByName(view, 'button', 'Dismiss the note about earlier files'));
    expect(textOf(view)).not.toContain('rates-notice.pdf');
  });

  it('shows nothing when there were none', async () => {
    const view = await render(<DocumentsPanel legacyPicks="tenant" />);
    expect(textOf(view)).not.toContain('Files you picked before');
  });
});
