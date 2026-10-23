import { cleanup, click, descendants, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { complaintOf, stepOf } from '@/app/test-utils/complaints';
import OwnerComplaintsPage from './page';

const mocks = vi.hoisted(() => ({ listAgainstMe: vi.fn() }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { complaints: { listAgainstMe: mocks.listAgainstMe, respond: vi.fn(), setStatus: vi.fn() } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// Seen from the owner's side: Tia lodged it and the owner answered.
const theirs = complaintOf({
  timeline: [
    stepOf('s1', { actor: 'complainant' }),
    stepOf('s2', { kind: 'responded', actor: 'you', created_at: '2026-10-02T00:00:00Z' }),
    stepOf('s3', { kind: 'status', status: 'resolved', actor: 'staff', note: 'The heater was replaced.', created_at: '2026-10-04T00:00:00Z' }),
  ],
  status: 'resolved', is_escalated: false, resolution_note: 'The heater was replaced.',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAgainstMe.mockResolvedValue([theirs, complaintOf({ id: 'c2', subject: 'Noise', status: 'open', is_escalated: false, timeline: [] })]);
});
afterEach(cleanup);

describe('the owner\'s complaints', () => {
  it('show where each complaint stands and its timeline from the owner\'s side', async () => {
    const view = await render(<OwnerComplaintsPage />);

    expect(textOf(view)).toContain('1 awaiting your response.');
    const timeline = descendants(view).find((element) => element.getAttribute('aria-label') === 'Timeline of Mould in the bathroom')!;
    expect(textOf(timeline)).toContain('Tia Nguyen lodged the complaint');
    expect(textOf(timeline)).toContain('You responded');
    expect(textOf(timeline)).toContain('TenantVoice set the status to Resolved');
    expect(textOf(timeline)).toContain('The heater was replaced.');
  });

  it('filters by status', async () => {
    const view = await render(<OwnerComplaintsPage />);

    await click(getByName(view, 'button', 'Resolved'));
    expect(getByName(view, 'button', 'Resolved').getAttribute('aria-pressed')).toBe('true');
    expect(textOf(view)).toContain('Mould in the bathroom');
    expect(textOf(view)).not.toContain('Noise');
    await click(getByName(view, 'button', 'Withdrawn'));
    expect(textOf(view)).toContain('Nothing matches this filter');
  });

  it('offers a retry when the complaints cannot load, and says when there are none', async () => {
    mocks.listAgainstMe.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'));
    mocks.listAgainstMe.mockResolvedValueOnce([]);
    const view = await render(<OwnerComplaintsPage />);

    expect(textOf(view)).toContain("Couldn't load the complaints");
    await click(getByName(view, 'button', 'Try again'));
    expect(textOf(view)).toContain('Complaints raised about your properties will appear here.');
  });

  it('keeps the page at AA contrast, also under the pointer', async () => {
    const view = await render(<OwnerComplaintsPage />);
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
