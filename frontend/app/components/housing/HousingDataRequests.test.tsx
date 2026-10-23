import { cleanup, descendants, dispatch, render, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { DatapointRequest } from '@/app/lib/housing-api';
import HousingDataRequests from './HousingDataRequests';

const mocks = vi.hoisted(() => ({ list: vi.fn(), send: vi.fn() }));
vi.mock('@/app/lib/housing-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/housing-api')>()),
  housingApi: { datapointRequests: mocks.list, requestDatapointChange: mocks.send },
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
  mocks.list.mockResolvedValue([]);
  mocks.send.mockResolvedValue(REQUEST);
});
afterEach(cleanup);

describe('an officer\'s data category requests', () => {
  it('needs a change and a reason before anything is sent', async () => {
    const view = await render(<HousingDataRequests />);

    await typeInto(field(view, 'TEXTAREA', 0), 'Add Pest control.');
    await dispatch(form(view), 'submit');

    expect(mocks.send).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Say what should change and why.');
  });

  it('sends the request and lists it with its status', async () => {
    const view = await render(<HousingDataRequests />);

    await typeInto(field(view, 'TEXTAREA', 0), ' Add Pest control as a repair category. ');
    await typeInto(field(view, 'TEXTAREA', 1), 'Pest complaints are filed under Other.');
    await dispatch(form(view), 'submit');

    expect(mocks.send).toHaveBeenCalledWith({
      datapoint: 'maintenance_categories', requested_change: 'Add Pest control as a repair category.', reason: 'Pest complaints are filed under Other.',
    });
    expect(textOf(view)).toContain('Request sent. The admins have been told');
    expect(textOf(view)).toContain('Waiting for an admin');
    expect(textOf(view)).toContain('Olive Officer');
  });

  it('says so when the same request is still waiting, and lists it once', async () => {
    mocks.list.mockResolvedValue([REQUEST]);
    const view = await render(<HousingDataRequests />);

    await typeInto(field(view, 'TEXTAREA', 0), 'Add Pest control as a repair category.');
    await typeInto(field(view, 'TEXTAREA', 1), 'Again.');
    await dispatch(form(view), 'submit');

    expect(textOf(view)).toContain('You already sent this request. It is still waiting for an admin.');
    expect(textOf(view).match(/Add Pest control as a repair category\./g)).toHaveLength(1);
  });

  it('shows the server\'s reason when a request is refused', async () => {
    mocks.send.mockRejectedValue(new ApiError(403, 'The Housing Portal is for authorised housing officers.'));
    const view = await render(<HousingDataRequests />);

    await typeInto(field(view, 'TEXTAREA', 0), 'Add Pest control.');
    await typeInto(field(view, 'TEXTAREA', 1), 'Pests.');
    await dispatch(form(view), 'submit');

    expect(textOf(view)).toContain('The Housing Portal is for authorised housing officers.');
    expect(lowContrastText(view)).toEqual([]);
  });
});
