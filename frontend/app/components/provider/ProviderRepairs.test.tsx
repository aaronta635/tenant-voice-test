import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { sydneyWallClock, type ProviderRepair } from '@/app/lib/provider-repairs';
import ProviderRepairs from './ProviderRepairs';

const mockRepairs = vi.hoisted(() => ({ list: vi.fn(), schedule: vi.fn(), complete: vi.fn() }));
vi.mock('@/app/lib/provider-repairs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/provider-repairs')>()),
  providerRepairs: mockRepairs,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const HOUR = 60 * 60 * 1000;
const assigned: ProviderRepair = {
  id: 'r1', status: 'in_progress', stage: 'assigned', category: 'PLUMBING', priority: 'urgent', title: 'Burst pipe',
  description: 'Water coming through the kitchen ceiling.', property_title: 'Harbour flat', suburb: 'Wollongong', state: 'NSW',
  address: null, access_notes: null, tenant_name: null, owner_id: 'owner-1', owner_name: 'Olivia Owner',
  appointment_at: null, estimated_duration_minutes: null, appointment_note: null, completed_at: null, completion_note: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};
const visitAt = (offset: number) => new Date(Date.now() + offset).toISOString();
const scheduled = (offset: number): ProviderRepair => ({
  ...assigned, id: 'r2', title: 'Flickering lights', category: 'ELECTRICAL', priority: 'medium', stage: 'scheduled',
  appointment_at: visitAt(offset), estimated_duration_minutes: 90, appointment_note: 'I will call first.',
  address: '12 Harbour St, Wollongong, NSW, 2500', access_notes: 'Key under the mat.', tenant_name: 'Jane Tenant',
});

const focused = () => document.activeElement as unknown as FakeElement;
const card = (view: FakeElement, title: string) =>
  getByName(view, 'h2', title).parentElement?.parentElement?.parentElement as unknown as FakeElement;
const formIn = (element: FakeElement) => descendants(element).find((node) => node.tagName === 'FORM') as FakeElement;

beforeEach(() => {
  vi.clearAllMocks();
  mockRepairs.list.mockResolvedValue([assigned]);
});
afterEach(cleanup);

describe('ProviderRepairs states', () => {
  it('says it is loading, then shows the repairs', async () => {
    let resolve!: (list: ProviderRepair[]) => void;
    mockRepairs.list.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = await render(<ProviderRepairs />);

    expect(textOf(view)).toContain('Loading your repairs…');
    await act(async () => resolve([assigned]));
    await settle();
    expect(textOf(view)).toContain('Burst pipe');
    expect(textOf(view)).toContain('1 needs a visit booked.');
  });

  it('offers a retry when the repairs cannot be loaded', async () => {
    mockRepairs.list.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    const view = await render(<ProviderRepairs />);

    expect(textOf(view)).toContain('Repairs could not be loaded');
    await click(getByName(view, 'button', 'Try again'));
    expect(mockRepairs.list).toHaveBeenCalledTimes(2);
    expect(textOf(view)).toContain('Burst pipe');
  });

  it('says when no repair is assigned yet', async () => {
    mockRepairs.list.mockResolvedValue([]);
    const view = await render(<ProviderRepairs />);

    expect(textOf(view)).toContain('No repairs assigned yet');
  });

  it('keeps the repairs at AA contrast', async () => {
    mockRepairs.list.mockResolvedValue([assigned, scheduled(2 * 24 * HOUR)]);

    expect(lowContrastText(await render(<ProviderRepairs />))).toEqual([]);
  });
});

describe('an assigned repair', () => {
  it('shows the suburb and says the street comes with the booked visit', async () => {
    const view = await render(<ProviderRepairs />);
    const repair = card(view, 'Burst pipe');

    expect(textOf(repair)).toContain('Wollongong, NSW');
    expect(textOf(repair)).toContain('Plumbing · Urgent');
    expect(textOf(repair)).toContain('Needs a visit');
    expect(textOf(repair)).toContain('The street address, access notes and tenant appear here once you book the visit.');
    expect(textOf(repair)).not.toContain('Mark done');
  });

  it('books the visit in Sydney time and says so in its card', async () => {
    const booked = { ...scheduled(24 * HOUR), id: 'r1', title: 'Burst pipe' };
    mockRepairs.schedule.mockResolvedValue(booked);
    const view = await render(<ProviderRepairs />);

    await click(getByName(view, 'button', 'Book visit for Burst pipe'));
    await dispatch(formIn(card(view, 'Burst pipe')), 'submit');

    const tomorrow = sydneyWallClock(new Date(Date.now() + 24 * HOUR)).slice(0, 10);
    expect(mockRepairs.schedule).toHaveBeenCalledWith('r1', { date: tomorrow, time: '09:00', duration_minutes: 60, note: null });
    expect(textOf(focused())).toMatch(/^Visit booked for .+\. The tenant and the owner have been told\.$/);
    expect(textOf(card(view, 'Burst pipe'))).toContain('12 Harbour St, Wollongong, NSW, 2500');
    expect(textOf(card(view, 'Burst pipe'))).toContain('Visit booked');
  });

  it('keeps the form and moves focus to the reason when the server refuses the visit', async () => {
    mockRepairs.schedule.mockRejectedValue(new ApiError(409, 'This repair changed while you were booking the visit. Reload and try again.'));
    const view = await render(<ProviderRepairs />);

    await click(getByName(view, 'button', 'Book visit for Burst pipe'));
    await dispatch(formIn(card(view, 'Burst pipe')), 'submit');

    expect(textOf(focused())).toBe('This repair changed while you were booking the visit. Reload and try again.');
    expect(formIn(card(view, 'Burst pipe'))).toBeDefined();
  });

  it('says why an unverified provider cannot take the job on, with the way to their documents', async () => {
    const message = 'Your account needs to be verified before you can take on repairs. Upload the documents it asks for, or wait for the review to finish.';
    mockRepairs.schedule.mockRejectedValue(new ApiError(403, message, {
      code: 'verification_required', action: 'receive_repairs', status: 'pending', message,
      documents_href: '/dashboard/profile#verification-documents',
    }));
    const view = await render(<ProviderRepairs />);

    await click(getByName(view, 'button', 'Book visit for Burst pipe'));
    await dispatch(formIn(card(view, 'Burst pipe')), 'submit');

    const form = formIn(card(view, 'Burst pipe'));
    expect(textOf(focused())).toBe(`Verification needed${message}Go to your documents`);
    expect(getByName(form, 'a', 'Go to your documents').getAttribute('href')).toBe('/dashboard/profile#verification-documents');
    expect(textOf(card(view, 'Burst pipe'))).not.toContain('Visit booked');
    expect(lowContrastText(form)).toEqual([]);
  });

  it('names each open form after its repair', async () => {
    mockRepairs.list.mockResolvedValue([assigned, scheduled(-HOUR)]);
    const view = await render(<ProviderRepairs />);

    await click(getByName(view, 'button', 'Book visit for Burst pipe'));
    await click(getByName(view, 'button', 'Mark done: Flickering lights'));

    expect(descendants(view).filter((element) => element.tagName === 'FORM').map((form) => form.getAttribute('aria-label')))
      .toEqual(['Visit for Burst pipe', 'Mark Flickering lights done']);
  });

  it('refuses a visit time that has passed before sending it', async () => {
    const view = await render(<ProviderRepairs />);
    await click(getByName(view, 'button', 'Book visit for Burst pipe'));
    const date = descendants(card(view, 'Burst pipe')).find((element) => element.id.endsWith('-date')) as FakeElement;

    await typeInto(date, '2020-01-01');
    await dispatch(formIn(card(view, 'Burst pipe')), 'submit');

    expect(mockRepairs.schedule).not.toHaveBeenCalled();
    expect(textOf(card(view, 'Burst pipe'))).toContain('Choose a visit time that has not passed yet.');
    expect(focused()).toBe(date);
  });
});

describe('a booked repair', () => {
  it('shows the street, access notes and tenant, and waits for the visit before it can be marked done', async () => {
    mockRepairs.list.mockResolvedValue([scheduled(2 * 24 * HOUR)]);
    const view = await render(<ProviderRepairs />);
    const repair = card(view, 'Flickering lights');

    expect(textOf(repair)).toContain('12 Harbour St, Wollongong, NSW, 2500');
    expect(textOf(repair)).toContain('Key under the mat.');
    expect(textOf(repair)).toContain('Jane Tenant');
    expect(textOf(repair)).toContain('about 1 h 30 min');
    const done = getByName(view, 'button', 'Mark done: Flickering lights');
    expect(textOf(done)).toBe('Mark done: Flickering lights');
    expect(done.hasAttribute('disabled')).toBe(true);
    expect(textOf(descendants(view).find((element) => element.id === done.getAttribute('aria-describedby')) as FakeElement))
      .toBe('You can mark it done once the visit starts.');
  });

  it('is marked done with a note once the visit has started, and stays in place with its message', async () => {
    const started = scheduled(-HOUR);
    mockRepairs.list.mockResolvedValue([started]);
    mockRepairs.complete.mockResolvedValue({ ...started, stage: 'completed', status: 'awaiting_confirmation', completed_at: visitAt(0), completion_note: 'Replaced the switch.' });
    const view = await render(<ProviderRepairs />);

    await click(getByName(view, 'button', 'Mark done: Flickering lights'));
    await dispatch(formIn(card(view, 'Flickering lights')), 'submit');
    expect(mockRepairs.complete).not.toHaveBeenCalled();
    expect(textOf(card(view, 'Flickering lights'))).toContain('Say what you did');

    const note = descendants(card(view, 'Flickering lights')).find((element) => element.tagName === 'TEXTAREA') as FakeElement;
    await typeInto(note, 'Replaced the switch.');
    await dispatch(formIn(card(view, 'Flickering lights')), 'submit');

    expect(mockRepairs.complete).toHaveBeenCalledWith('r2', 'Replaced the switch.');
    expect(textOf(focused())).toBe('Repair marked done. The tenant and the owner have been told, and the tenant confirms it next.');
    expect(textOf(card(view, 'Flickering lights'))).toContain('Replaced the switch.');
    // The shared database waits for the tenant to confirm the work.
    expect(textOf(card(view, 'Flickering lights'))).toContain('Waiting for the tenant to confirm the work.');
    expect(getByName(view, 'button', /^To do/).textContent).toContain('(0)');
    expect(getByName(view, 'button', /^Done and cancelled/).textContent).toContain('(1)');
  });

  it('opens Mark done on its note even after an earlier form was refused', async () => {
    mockRepairs.list.mockResolvedValue([scheduled(-HOUR)]);
    mockRepairs.schedule.mockRejectedValue(new ApiError(409, 'This repair changed while you were booking the visit. Reload and try again.'));
    const view = await render(<ProviderRepairs />);

    await click(getByName(view, 'button', 'Move visit for Flickering lights'));
    const date = descendants(card(view, 'Flickering lights')).find((element) => element.id.endsWith('-date')) as FakeElement;
    await typeInto(date, '2099-01-01');
    await dispatch(formIn(card(view, 'Flickering lights')), 'submit');
    expect(mockRepairs.schedule).toHaveBeenCalled();
    await click(getByName(view, 'button', 'Cancel'));
    await click(getByName(view, 'button', 'Mark done: Flickering lights'));

    expect(focused().tagName).toBe('TEXTAREA');
  });

  it('lists finished jobs under their own filter', async () => {
    mockRepairs.list.mockResolvedValue([assigned, { ...scheduled(-HOUR), stage: 'completed', status: 'resolved', completion_note: 'Fixed.' }]);
    const view = await render(<ProviderRepairs />);

    expect(textOf(view)).not.toContain('Flickering lights');
    await click(getByName(view, 'button', /^Done and cancelled/));
    expect(textOf(view)).toContain('Flickering lights');
    expect(textOf(view)).not.toContain('Burst pipe');
  });
});
