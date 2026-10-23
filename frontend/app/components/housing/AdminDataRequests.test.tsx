import { cleanup, descendants, dispatch, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { DatapointRequest } from '@/app/lib/housing-api';
import AdminDataRequests from './AdminDataRequests';

const mocks = vi.hoisted(() => ({ adminList: vi.fn(), answer: vi.fn() }));
vi.mock('@/app/lib/housing-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/housing-api')>()),
  adminDatapointApi: { list: mocks.adminList, answer: mocks.answer },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const REQUEST: DatapointRequest = {
  id: 'req-1', officer_id: 'ola', officer_name: 'Olive Officer', datapoint: 'maintenance_categories', datapoint_label: 'Maintenance categories',
  requested_change: 'Add Pest control as a repair category.', reason: 'Pest complaints are filed under Other.', status: 'pending',
  admin_response: null, responded_by_name: null, responded_at: null, created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z',
};

const field = (view: FakeElement, tag: string, index = 0) => descendants(view).filter((element) => element.tagName === tag)[index];
const form = (view: FakeElement) => field(view, 'FORM');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminList.mockResolvedValue([REQUEST]);
  mocks.answer.mockImplementation(async (id: string, status: string, response: string) => ({
    ...REQUEST, status, admin_response: response, responded_by_name: 'Ada Admin', responded_at: '2026-10-21T00:00:00Z',
  }));
});
afterEach(cleanup);

describe('the admins\' answers', () => {
  it('answers a request with a decision and a response, and stops offering one once it is final', async () => {
    const view = await render(<AdminDataRequests />);
    expect(textOf(view)).toContain('From Olive Officer');

    const decision = field(view, 'SELECT');
    decision.value = 'completed';
    await dispatch(decision, 'change');
    await typeInto(field(view, 'TEXTAREA'), ' Added to the repair form. ');
    await dispatch(form(view), 'submit');

    expect(mocks.answer).toHaveBeenCalledWith('req-1', 'completed', 'Added to the repair form.', 'pending');
    expect(textOf(view)).toContain('Response from Ada Admin');
    expect(textOf(view)).toContain('Completed');
    expect(descendants(view).some((element) => element.tagName === 'FORM')).toBe(false);
  });

  it('needs a response, and shows a refusal', async () => {
    mocks.answer.mockRejectedValue(new ApiError(409, 'This request is now accepted. Reload the requests and try again.'));
    const view = await render(<AdminDataRequests />);

    await dispatch(form(view), 'submit');
    expect(textOf(view)).toContain('Write a response.');
    expect(mocks.answer).not.toHaveBeenCalled();

    await typeInto(field(view, 'TEXTAREA'), 'Yes.');
    await dispatch(form(view), 'submit');
    expect(textOf(view)).toContain('This request is now accepted. Reload the requests and try again.');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('says when no officer has asked for anything, and when the list cannot load', async () => {
    mocks.adminList.mockResolvedValueOnce([]);
    expect(textOf(await render(<AdminDataRequests />))).toContain('No officer has asked for a change yet.');
    await cleanup();

    mocks.adminList.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    expect(textOf(await render(<AdminDataRequests />))).toContain("Couldn't load the requests");
  });
});
