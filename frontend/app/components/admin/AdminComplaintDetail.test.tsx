import { cleanup, click, descendants, dispatch, getByName, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { adminComplaintDetail } from '@/app/test-utils/admin-moderation';
import AdminComplaintDetail from './AdminComplaintDetail';

const mocks = vi.hoisted(() => ({ get: vi.fn(), setStatus: vi.fn(), assign: vi.fn(), assignees: vi.fn() }));
vi.mock('@/app/lib/admin-complaints-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-complaints-api')>()),
  adminComplaintsApi: { get: mocks.get, setStatus: mocks.setStatus, assign: mocks.assign, assignees: mocks.assignees },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const OTTO = { id: 'otto', full_name: 'Otto Admin', email: 'otto@example.test' };
const ADA = { id: 'ada', full_name: 'Ada Admin', email: 'ada@example.test' };

const answered = adminComplaintDetail('c1', {
  status: 'IN_REVIEW', responded: true, response: 'A technician comes Friday.', responded_at: '2026-10-02T00:00:00Z',
  evidence_urls: ['https://example.test/heater.jpg'],
  transitions: ['ESCALATED', 'RESOLVED', 'CLOSED'],
  timeline: [
    { id: 'e1', event_type: 'CREATED', note: null, from_status: null, to_status: null, actor: { id: 'tia', full_name: 'Tia Nguyen', role: 'tenant' }, assignee: null, source: 'web', created_at: '2026-10-01T00:00:00Z' },
    { id: 'e2', event_type: 'RESPONDED', note: 'A technician comes Friday.', from_status: 'open', to_status: 'under_review', actor: { id: 'oliver', full_name: 'Oliver Grant', role: 'landlord' }, assignee: null, source: 'web', created_at: '2026-10-02T00:00:00Z' },
    { id: 'e3', event_type: 'ASSIGNED', note: 'Yours', from_status: null, to_status: null, actor: { id: 'ada', full_name: 'Ada Admin', role: 'admin' }, assignee: { id: 'otto', full_name: 'Otto Admin', role: 'admin' }, source: 'web', created_at: '2026-10-03T00:00:00Z' },
    { id: 'e4', event_type: 'REVIEWED', note: 'Called the tenant.', from_status: null, to_status: null, actor: null, assignee: null, source: 'other', created_at: '2026-10-04T00:00:00Z' },
  ],
  assignee: { id: 'otto', full_name: 'Otto Admin', role: 'admin' },
});

const field = (view: FakeElement, label: string) => {
  const element = descendants(view).find((item) => item.tagName === 'LABEL' && textOf(item).startsWith(label))!;
  return descendants(view).find((item) => item.id === element.getAttribute('for'))!;
};
const card = (view: FakeElement, heading: string) =>
  descendants(view).find((element) => element.tagName === 'H2' && textOf(element) === heading)!.parentElement!;
const formIn = (element: FakeElement) => descendants(element).find((item) => item.tagName === 'FORM')!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(answered);
  mocks.assignees.mockResolvedValue([ADA, OTTO]);
});
afterEach(cleanup);

describe('one complaint in the admin console', () => {
  it('shows what was reported, the response and every step, staff-only ones too', async () => {
    const view = await render(<AdminComplaintDetail complaintId="c1" />);

    expect(mocks.get).toHaveBeenCalledWith('c1');
    expect(textOf(view)).toContain('Complaint c1');
    expect(textOf(view)).toContain('In review');
    const reported = card(view, 'What was reported');
    expect(getByName(reported, 'a', 'Tia Nguyen').getAttribute('href')).toBe('/admin/users/tia');
    expect(getByName(reported, 'a', 'Evidence 1').getAttribute('href')).toBe('https://example.test/heater.jpg');
    expect(textOf(reported)).toContain('A technician comes Friday.');
    const timeline = textOf(card(view, 'Timeline'));
    expect(timeline).toContain('Tia Nguyen lodged it');
    expect(timeline).toContain('Oliver Grant responded');
    expect(timeline).toContain('Ada Admin handed it to Otto Admin');
    expect(timeline).toContain('Someone: reviewed');
    expect(timeline).toContain('Recorded in another TenantVoice app');
    expect(textOf(card(view, 'Handled by'))).toContain('Otto Admin handles it now.');
  });

  it('needs a note to change the status, sends the status the admin saw and says both parties were told', async () => {
    mocks.setStatus.mockResolvedValue({ ...answered, status: 'RESOLVED', transitions: ['IN_REVIEW'], resolution_note: 'Heater replaced.' });
    const view = await render(<AdminComplaintDetail complaintId="c1" />);
    const status = card(view, 'Status');

    expect((field(status, 'New status') as FakeElement).options.map(textOf)).toEqual(['Escalate', 'Resolve', 'Close']);
    await dispatch(formIn(status), 'submit');
    expect(mocks.setStatus).not.toHaveBeenCalled();
    expect(textOf(status)).toContain('Write a note. Both parties see it with the new status.');
    expect((field(status, 'Note') as FakeElement).getAttribute('aria-invalid')).toBe('true');

    const select = field(status, 'New status') as FakeElement;
    select.value = 'RESOLVED';
    await dispatch(select, 'change');
    await typeInto(field(status, 'Note') as FakeElement, 'Heater replaced.');
    await dispatch(formIn(status), 'submit');

    expect(mocks.setStatus).toHaveBeenCalledWith(answered, 'RESOLVED', 'Heater replaced.');
    expect(textOf(view)).toContain('The complaint is now resolved. Both parties were told.');
    expect(textOf(card(view, 'What was reported'))).toContain('Heater replaced.');
    expect((field(card(view, 'Status'), 'New status') as FakeElement).options.map(textOf)).toEqual(['Reopen']);
  });

  it('reloads the complaint when someone changed it first, saving nothing', async () => {
    mocks.setStatus.mockRejectedValue(new ApiError(409, 'This complaint changed while you were looking at it. Reload it and try again.'));
    mocks.get.mockResolvedValueOnce(answered).mockResolvedValueOnce({ ...answered, status: 'ESCALATED', transitions: ['IN_REVIEW', 'RESOLVED', 'CLOSED'] });
    const view = await render(<AdminComplaintDetail complaintId="c1" />);
    const status = card(view, 'Status');

    await typeInto(field(status, 'Note') as FakeElement, 'Resolving.');
    await dispatch(formIn(status), 'submit');

    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(textOf(view)).toContain('This complaint changed while you were looking at it, so nothing was saved.');
    expect(textOf(view)).toContain('Escalated');
  });

  it('hands the complaint to another admin, or to nobody', async () => {
    mocks.assign.mockResolvedValueOnce({ ...answered, assignee: { id: 'ada', full_name: 'Ada Admin', role: 'admin' } });
    const view = await render(<AdminComplaintDetail complaintId="c1" />);
    const handled = card(view, 'Handled by');

    const admin = field(handled, 'Admin') as FakeElement;
    expect(admin.options.map(textOf)).toEqual(['Nobody', 'Ada Admin', 'Otto Admin']);
    admin.value = 'ada';
    await dispatch(admin, 'change');
    await typeInto(field(handled, 'Note') as FakeElement, 'Covering for Otto');
    expect(getByName(handled, 'button', 'Hand it over').getAttribute('type')).toBe('submit');
    await dispatch(formIn(handled), 'submit');

    expect(mocks.assign).toHaveBeenCalledWith('c1', 'ada', 'Covering for Otto');
    expect(textOf(view)).toContain('Ada Admin now handles this complaint.');
  });

  it('says when a complaint is not found, and offers a retry when it cannot load', async () => {
    mocks.get.mockRejectedValueOnce(new ApiError(404, 'Complaint not found'));
    const missing = await render(<AdminComplaintDetail complaintId="gone" />);
    expect(textOf(missing)).toContain('Complaint not found');
    await cleanup();

    mocks.get.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const failed = await render(<AdminComplaintDetail complaintId="c1" />);
    expect(textOf(failed)).toContain("Couldn't load the complaint");
    await click(getByName(failed, 'button', 'Try again'));
    expect(textOf(failed)).toContain('Complaint c1');
  });

  it('keeps a withdrawn complaint as it is', async () => {
    mocks.get.mockResolvedValue({ ...answered, status: 'CLOSED', withdrawn: true, transitions: [] });
    const view = await render(<AdminComplaintDetail complaintId="c1" />);

    expect(textOf(card(view, 'Status'))).toContain('withdrew this complaint, so its status no longer changes');
    expect(descendants(card(view, 'Status')).some((element) => element.tagName === 'FORM')).toBe(false);
  });

  it('keeps the page at AA contrast, also under the pointer', async () => {
    const view = await render(<AdminComplaintDetail complaintId="c1" />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
