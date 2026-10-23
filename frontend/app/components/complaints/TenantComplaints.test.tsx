import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { complaintOf } from '@/app/test-utils/complaints';
import TenantComplaints from './TenantComplaints';

const mocks = vi.hoisted(() => ({
  listMine: vi.fn(), listAgainstMe: vi.fn(), create: vi.fn(), respond: vi.fn(), tenancies: vi.fn(), categories: vi.fn(),
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    complaints: {
      listMine: mocks.listMine, listAgainstMe: mocks.listAgainstMe, create: mocks.create, respond: mocks.respond,
      setStatus: vi.fn(),
    },
  },
}));
vi.mock('@/app/lib/complaint-categories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/complaint-categories')>()),
  complaintCategoriesApi: { list: mocks.categories, tenancies: mocks.tenancies },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const tenancy = { listing_id: 'listing-1', title: 'Harbour flat', address: '12 Harbour St' };
const categories = [
  { code: 'PROPERTY_CONDITION', name: 'Property condition', description: 'Damage, damp or mould.' },
  { code: 'SAFETY', name: 'Safety', description: 'A risk to health or safety.' },
];

const field = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item).startsWith(label))!;
  return descendants(view).find((item) => item.id === element.getAttribute('for'))!;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listMine.mockResolvedValue([complaintOf()]);
  mocks.listAgainstMe.mockResolvedValue([]);
  mocks.tenancies.mockResolvedValue([tenancy]);
  mocks.categories.mockResolvedValue(categories);
});
afterEach(cleanup);

describe('the tenant\'s complaints', () => {
  it('show each complaint\'s status and timeline, with TenantVoice\'s note', async () => {
    const view = await render(<TenantComplaints />);

    expect(textOf(view)).toContain('Mould in the bathroom');
    expect(textOf(view)).toContain('Mould');
    expect(textOf(view)).toContain('Escalated');
    const timeline = descendants(view).find((element) => element.getAttribute('aria-label') === 'Timeline of Mould in the bathroom')!;
    const steps = descendants(timeline).filter((element) => element.tagName === 'LI')
      .map((item) => descendants(item).filter((element) => element.tagName === 'P').map(textOf));
    expect(steps).toEqual([
      ['You lodged the complaint · 1 Oct 2026'],
      ['Oliver Grant responded · 2 Oct 2026'],
      ['TenantVoice set the status to Escalated · 3 Oct 2026', 'We asked for the repair invoice.'],
    ]);
  });

  it('offers the fixed categories and the tenant\'s rentals, and sends the chosen code and severity', async () => {
    mocks.create.mockResolvedValue(complaintOf({ id: 'c2', subject: 'Smoke alarm', category: 'SAFETY', category_label: 'Safety', timeline: [] }));
    const view = await render(<TenantComplaints />);
    await click(getByName(view, 'button', 'Lodge a complaint'));

    expect(mocks.categories).toHaveBeenCalledTimes(1);
    const form = descendants(view).find((element) => element.tagName === 'FORM')!;
    expect(descendants(form).filter((element) => element.getAttribute('aria-pressed') !== null).map(textOf)).toEqual([
      'Property condition', 'Safety']);
    const select = field(view, 'Rental') as FakeElement;
    expect(select.options.map(textOf)).toEqual(['Select a rental…', 'Harbour flat — 12 Harbour St']);
    select.value = 'listing-1';
    await dispatch(select, 'change');
    const severity = field(view, 'How serious is it?') as FakeElement;
    expect(severity.value).toBe('MEDIUM');
    severity.value = 'HIGH';
    await dispatch(severity, 'change');
    await typeInto(field(view, 'Subject') as FakeElement, 'Smoke alarm');
    await typeInto(field(view, 'What happened?') as FakeElement, 'The smoke alarm has no battery.');

    await dispatch(form, 'submit');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Choose the category that fits best.');

    await click(getByName(view, 'button', 'Safety'));
    expect(textOf(view)).toContain('A risk to health or safety.');
    await dispatch(form, 'submit');

    expect(mocks.create).toHaveBeenCalledWith({
      subject: 'Smoke alarm', description: 'The smoke alarm has no battery.', category: 'SAFETY', severity: 'HIGH',
      property_id: 'listing-1',
    });
    expect(textOf(view)).toContain('Smoke alarm');
    expect(textOf(view)).not.toContain('New complaint');
  });

  it('asks for a description of 10 to 3000 characters, trimmed', async () => {
    const view = await render(<TenantComplaints />);
    await click(getByName(view, 'button', 'Lodge a complaint'));
    const select = field(view, 'Rental') as FakeElement;
    select.value = 'listing-1';
    await dispatch(select, 'change');
    await click(getByName(view, 'button', 'Safety'));
    await typeInto(field(view, 'Subject') as FakeElement, 'Smoke alarm');
    await typeInto(field(view, 'What happened?') as FakeElement, '   Broken.   ');

    await dispatch(descendants(view).find((element) => element.tagName === 'FORM')!, 'submit');

    expect(mocks.create).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Describe what happened in 10 to 3000 characters.');
    expect(textOf(view)).toContain('7 of 3000 characters (at least 10)');
  });

  it('explains that a complaint needs an approved application, and retries the rentals after a failure', async () => {
    mocks.tenancies.mockRejectedValueOnce(new ApiError(503, 'Unavailable')).mockResolvedValueOnce([]);
    const view = await render(<TenantComplaints />);
    await click(getByName(view, 'button', 'Lodge a complaint'));

    expect(textOf(view)).toContain('Your rentals could not be loaded.');
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('You can lodge a complaint about a rental once an application of yours for it is approved.');
    expect(getByName(view, 'button', 'Submit complaint').hasAttribute('disabled')).toBe(true);
  });

  it('says when no category is open, and lets the categories load again after a failure', async () => {
    mocks.categories.mockRejectedValueOnce(new ApiError(503, 'Unavailable')).mockResolvedValueOnce([]);
    const view = await render(<TenantComplaints />);
    await click(getByName(view, 'button', 'Lodge a complaint'));

    expect(textOf(view)).toContain('The categories could not be loaded.');
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('No complaint categories are open right now.');
    expect(getByName(view, 'button', 'Submit complaint').hasAttribute('disabled')).toBe(true);
  });

  it('shows an error with a retry when the complaints cannot load, and an empty state', async () => {
    mocks.listMine.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    mocks.listMine.mockResolvedValueOnce([]);
    const view = await render(<TenantComplaints />);

    expect(textOf(view)).toContain("Couldn't load your complaints");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('No complaints raised');
  });

  it('keeps the complaints the tenant raised when those about them fail, and retries those alone', async () => {
    const about = complaintOf({
      id: 'c9', subject: 'Noise after midnight', complainant_name: 'Oliver Grant', is_escalated: false, status: 'open',
      timeline: [],
    });
    mocks.listAgainstMe.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'))
      .mockResolvedValueOnce([about]);
    const view = await render(<TenantComplaints />);

    expect(textOf(view)).toContain('Mould in the bathroom');
    expect(textOf(view)).not.toContain("Couldn't load your complaints");
    const section = descendants(view).find((element) => element.getAttribute('aria-labelledby') === 'complaints-about-you')!;
    expect(textOf(section)).toContain("Couldn't load the complaints about you");
    expect(textOf(section)).toContain('The service is temporarily unavailable. Please try again.');

    await click(getByName(section, 'button', 'Try again'));

    expect(textOf(view)).toContain('Noise after midnight');
    expect(textOf(view)).toContain('Mould in the bathroom');
    expect(textOf(view)).not.toContain("Couldn't load the complaints about you");
    expect(mocks.listMine).toHaveBeenCalledTimes(1);
    expect(mocks.listAgainstMe).toHaveBeenCalledTimes(2);
  });

  it('still lists the complaints about the tenant when their own fail', async () => {
    mocks.listMine.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    mocks.listAgainstMe.mockResolvedValue([complaintOf({ id: 'c9', subject: 'Noise after midnight', timeline: [] })]);
    const view = await render(<TenantComplaints />);

    expect(textOf(view)).toContain("Couldn't load your complaints");
    expect(textOf(view)).toContain('Noise after midnight');
  });

  it('lists the complaints lodged about the tenant, which the notices link to, and takes their response', async () => {
    const about = complaintOf({
      id: 'c9', subject: 'Noise after midnight', complainant_name: 'Oliver Grant', is_escalated: false, status: 'open',
      timeline: [],
    });
    mocks.listMine.mockResolvedValue([]);
    mocks.listAgainstMe.mockResolvedValue([about]);
    mocks.respond.mockResolvedValue({ ...about, status: 'under_review', response: 'We have moved the speakers.' });
    const view = await render(<TenantComplaints />);

    expect(textOf(view)).toContain('No complaints raised');
    const section = descendants(view).find((element) => element.getAttribute('aria-labelledby') === 'complaints-about-you')!;
    expect(textOf(section)).toContain('Complaints about you');
    expect(textOf(section)).toContain('Noise after midnight');
    expect(textOf(section)).toContain('Raised by Oliver Grant');
    expect(descendants(section).some((element) => textOf(element) === 'Withdraw complaint')).toBe(false);

    await click(getByName(section, 'button', 'Respond'));
    await typeInto(descendants(section).find((element) => element.tagName === 'TEXTAREA')!, 'We have moved the speakers.');
    await click(getByName(section, 'button', 'Send response'));

    expect(mocks.respond).toHaveBeenCalledWith('c9', 'We have moved the speakers.');
    expect(textOf(section)).toContain('We have moved the speakers.');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('keeps the page at AA contrast, also under the pointer', async () => {
    const view = await render(<TenantComplaints />);
    await click(getByName(view, 'button', 'Lodge a complaint'));

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
