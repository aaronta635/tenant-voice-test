import { cleanup, click, descendants, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { ProviderJob } from '@/app/lib/provider-jobs';
import ProviderJobRequests from './ProviderJobRequests';

const mockJobs = vi.hoisted(() => ({ list: vi.fn(), move: vi.fn() }));
vi.mock('@/app/lib/provider-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/provider-jobs')>()),
  providerJobs: mockJobs,
}));
vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const job: ProviderJob = {
  id: 'j1', title: 'Fix the gutters', description: 'Both sides of the roof.', status: 'pending', owner_id: 'o1',
  owner_name: 'Olivia Owner', property_title: 'Harbour flat', listing_id: 'l1', from_repair: false,
  created_at: '2030-01-10T00:00:00Z', next_statuses: ['accepted', 'declined'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockJobs.list.mockResolvedValue([job, { ...job, id: 'j2', title: 'Unblock a drain', from_repair: true, status: 'completed', next_statuses: [] }]);
});
afterEach(cleanup);

describe('job requests from the mobile app', () => {
  it('lists them with what the provider may do next', async () => {
    const view = await render(<ProviderJobRequests />);

    expect(textOf(view)).toContain('Fix the gutters');
    expect(textOf(view)).toContain('Olivia Owner · Harbour flat');
    expect(textOf(view)).toContain('1 is open.');
    expect(textOf(view)).toContain('This came with a repair');
    getByName(view, 'button', 'Accept: Fix the gutters');
    getByName(view, 'button', 'Decline: Fix the gutters');
  });

  it('lets a long word or link in a job wrap instead of widening the page', async () => {
    const view = await render(<ProviderJobRequests />);

    // A grid item is as wide as its content unless told otherwise.
    const items = descendants(view).filter((element) => element.tagName === 'LI');
    expect(items.length).toBe(2);
    expect(items.every((item) => (item.getAttribute('class') ?? '').split(' ').includes('min-w-0'))).toBe(true);
    const title = descendants(view).find((element) => element.tagName === 'H3')!;
    expect(title.getAttribute('class')).toContain('[overflow-wrap:anywhere]');
  });

  it('says that declining a repair\'s job request does not hand the repair back', async () => {
    // mobile_ai_provider_job changes only the job's status: the work order stays assigned to the provider.
    mockJobs.list.mockResolvedValue([{ ...job, id: 'j3', title: 'Fix the tap', from_repair: true }]);
    const view = await render(<ProviderJobRequests />);

    expect(textOf(view)).toContain('Declining it here does not hand the repair back: ask the owner to assign someone else.');
  });

  it('accepts a job and says the owner was told', async () => {
    mockJobs.move.mockResolvedValue({ ...job, status: 'accepted', next_statuses: ['in_progress'] });
    const view = await render(<ProviderJobRequests />);

    await click(getByName(view, 'button', 'Accept: Fix the gutters'));

    expect(mockJobs.move).toHaveBeenCalledWith('j1', 'accepted');
    expect(textOf(view)).toContain('Job accepted. The owner has been told.');
    getByName(view, 'button', 'Start job: Fix the gutters');
  });

  it('shows the function\'s refusal of a move', async () => {
    mockJobs.move.mockRejectedValue(new ApiError(409, 'Invalid job status change.'));
    const view = await render(<ProviderJobRequests />);

    await click(getByName(view, 'button', 'Decline: Fix the gutters'));

    expect(textOf(view)).toContain('Invalid job status change.');
  });

  it('says when there are none, and offers a retry when they cannot be loaded', async () => {
    mockJobs.list.mockRejectedValueOnce(new ApiError(403, 'Sign in with an active Supabase account.')).mockResolvedValue([]);
    const view = await render(<ProviderJobRequests />);

    expect(textOf(view)).toContain('Sign in with an active Supabase account.');
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('No job requests yet.');
  });
});
