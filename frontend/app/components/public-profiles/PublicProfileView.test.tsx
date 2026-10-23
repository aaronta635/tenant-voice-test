import { cleanup, click, descendants, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicProfileDetail } from '@/app/lib/public-profiles';
import PublicProfileView from './PublicProfileView';

const connections = vi.hoisted(() => ({ state: vi.fn() }));
const messaging = vi.hoisted(() => ({ startRental: vi.fn(), push: vi.fn() }));
// Not in the page test: contrast needs a rendered tree, and that test renders markup.
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink(() => undefined),
}));
vi.mock('@/app/lib/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/connections')>()),
  getConnectionState: connections.state,
}));
vi.mock('@/app/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/api')>();
  return { ...actual, api: { ...actual.api, conversations: { ...actual.api.conversations, startRental: messaging.startRental } } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: messaging.push, refresh: () => undefined }) }));
vi.mock('@/app/lib/session-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/session-role')>()),
  getClientSessionRole: () => 'Client',
}));

beforeEach(() => {
  vi.clearAllMocks();
  connections.state.mockResolvedValue({ user_id: 'a1000000-0000-4000-8000-000000000001', state: 'none', connection_id: null });
});

afterEach(cleanup);

const profile: PublicProfileDetail = {
  id: 'a1000000-0000-4000-8000-000000000001', role: 'tenant', role_label: 'Tenant', display_name: 'Zara Q.',
  business_name: null, avatar_url: null, areas: ['Newtown'], about: 'Quiet nurse.', verified: true, rating_avg: 5,
  review_count: 1, budget_min: 500, budget_max: 800, move_in_month: '2026-11', categories: [], pricing_summary: null,
  service_area: null, provider_slug: null,
  reviews: [{ id: 'r1', rating: 5, title: 'Great tenant', body: 'Paid on time.', reviewer_label: 'Verified landlord',
    reply: 'Thank you!', replied_at: '2026-03-02T00:00:00+00:00', created_at: '2026-03-01T00:00:00+00:00',
    reported: false }],
};

describe('PublicProfileView', () => {
  it.each([false, true])('keeps the profile, badges, reviews and prompt at AA contrast (signed in: %s)', async (signedIn) => {
    const view = await render(<PublicProfileView profile={profile} signedIn={signedIn} />);

    expect(textOf(view)).toContain(signedIn ? 'Connect with Zara Q.' : 'Sign in or create an account to see more');
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });

  it('offers a signed-in member the Connect button in the spot for connecting', async () => {
    const view = await render(<PublicProfileView profile={profile} signedIn />);
    const [slot] = descendants(view).filter((element) => element.hasAttribute('data-connect-slot'));

    expect(connections.state).toHaveBeenCalledWith(profile.id);
    expect(getByName(slot, 'button', 'Connect with Zara Q.')).toBeTruthy();
  });

  it("tells a member on their own profile that it is theirs, instead of offering to connect", async () => {
    connections.state.mockResolvedValue({ user_id: profile.id, state: 'self', connection_id: null });
    const view = await render(<PublicProfileView profile={profile} signedIn />);
    const [slot] = descendants(view).filter((element) => element.hasAttribute('data-connect-slot'));

    expect(textOf(slot)).toContain('This is your public profile');
    expect(textOf(slot)).toContain('Members and visitors see it like this.');
    expect(textOf(view)).not.toContain('Connect with Zara Q.');
    expect(descendants(view).filter((element) => element.tagName === 'BUTTON')).toEqual([]);
  });

  it.each([
    ['none', 'Connect with Zara Q.', 'Once Zara Q. accepts, you can message each other.'],
    ['sent', 'Your request to Zara Q.', 'Once Zara Q. accepts, you can message each other.'],
    ['received', 'A request from Zara Q.', 'Accept it to message each other.'],
    ['connected', 'You and Zara Q. are connected', 'You can message each other.'],
    ['declined', 'Connecting with Zara Q.', 'Only Zara Q. can send a new request now.'],
  ] as const)('says what connecting means in the %s state', async (state, heading, line) => {
    connections.state.mockResolvedValue({ user_id: profile.id, state, connection_id: state === 'none' ? null : 'c1' });
    const view = await render(<PublicProfileView profile={profile} signedIn />);
    const [slot] = descendants(view).filter((element) => element.hasAttribute('data-connect-slot'));

    expect(textOf(slot).startsWith(heading)).toBe(true);
    expect(textOf(slot)).toContain(line);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('opens a conversation from a connected profile', async () => {
    connections.state.mockResolvedValue({ user_id: profile.id, state: 'connected', connection_id: 'c1' });
    messaging.startRental.mockResolvedValue({ id: 'thread-1' });
    const view = await render(<PublicProfileView profile={profile} signedIn />);

    await click(getByName(view, 'button', 'Message Zara Q.'));

    expect(messaging.startRental).toHaveBeenCalledWith({ peer_id: profile.id, subject: 'Chat with Zara Q.' });
    expect(messaging.push).toHaveBeenCalledWith('/tenant/messages?thread=thread-1');
  });

  it('says so when the conversation cannot be opened', async () => {
    connections.state.mockResolvedValue({ user_id: profile.id, state: 'connected', connection_id: 'c1' });
    messaging.startRental.mockRejectedValue(new Error('offline'));
    const view = await render(<PublicProfileView profile={profile} signedIn />);

    await click(getByName(view, 'button', 'Message Zara Q.'));

    expect(textOf(view)).toContain('Could not open the conversation. Please try again.');
    expect(messaging.push).not.toHaveBeenCalled();
  });

  it('leaves the spot out for staff and for a pair blocked in the mobile app', async () => {
    connections.state.mockResolvedValue({ user_id: profile.id, state: 'unavailable', connection_id: null });
    const view = await render(<PublicProfileView profile={profile} signedIn />);

    expect(descendants(view).some((element) => element.hasAttribute('data-connect-slot'))).toBe(false);
    expect(textOf(view)).not.toContain('Connect with Zara Q.');
  });

  it('marks a reported review, which stays up until a moderator decides, at AA contrast', async () => {
    const reported = { ...profile.reviews[0], id: 'r2', title: 'Not true', body: 'Under review.', reported: true };
    const view = await render(<PublicProfileView profile={{ ...profile, reviews: [profile.reviews[0], reported] }} signedIn={false} />);
    const items = descendants(view).filter((element) => element.tagName === 'LI' && textOf(element).includes('stars'));

    expect(items.map((item) => textOf(item).includes('Reported · under review'))).toEqual([false, true]);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('shows the rating pill and the verified seal beside the name', async () => {
    const view = await render(<PublicProfileView profile={profile} signedIn={false} />);
    const seal = descendants(view).find((element) => element.getAttribute('role') === 'img');

    expect(seal?.getAttribute('aria-label')).toBe('Verified by TenantVoice');
    expect(textOf(view)).toContain('Rated 5.0 out of 5 from 1 review');
    expect(textOf(descendants(view).find((element) => element.tagName === 'H1') as FakeElement)).toBe('Zara Q.');
  });

  it("gives the average of the owner scorecards a tenant chose to show, and no row without one", async () => {
    const shown = await render(<PublicProfileView profile={{ ...profile, scorecard: { average: 4.57, count: 2 } }} signedIn={false} />);

    expect(textOf(shown)).toContain('Scorecards4.6 out of 5 from 2 owner scorecards');
    expect(lowContrastText(shown)).toEqual([]);
    await cleanup();
    for (const scorecard of [null, undefined]) {
      expect(textOf(await render(<PublicProfileView profile={{ ...profile, scorecard }} signedIn={false} />))).not.toContain('Scorecards');
      await cleanup();
    }
  });

  it('hides the blurred filler from screen readers and keeps each section title readable', async () => {
    const view = await render(<PublicProfileView profile={profile} signedIn={false} />);
    const blurred = descendants(view).filter((element) => element.hasAttribute('data-private-placeholder'));

    expect(blurred).toHaveLength(5);
    expect(blurred.every((element) => element.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(blurred.map((element) => (element.previousSibling ? textOf(element.previousSibling) : ''))).toEqual([
      'Contact details', 'Rental history', 'Employment and income', 'References', 'Documents',
    ]);
  });
});
