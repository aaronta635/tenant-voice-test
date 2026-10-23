import { cleanup, click, descendants, getByName, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { ConnectionState, MemberSearchResult } from '@/app/lib/connections';
import NetworkRecommendations from './NetworkRecommendations';

const mockApi = vi.hoisted(() => ({
  properties: { listPublic: vi.fn() },
  applications: { listMine: vi.fn() },
  conversations: { startRental: vi.fn() },
  connections: { request: vi.fn(), respond: vi.fn(), remove: vi.fn() },
}));
const members = vi.hoisted(() => ({ search: vi.fn(), state: vi.fn() }));
const matching = vi.hoisted(() => ({ homes: vi.fn(), landlords: vi.fn() }));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));
vi.mock('@/app/lib/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/connections')>()),
  searchMembers: members.search,
  getConnectionState: members.state,
}));
vi.mock('@/app/lib/matching', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/matching')>()),
  getPropertyMatches: matching.homes,
  getLandlordMatches: matching.landlords,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navigation.push }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

function member(id: string, full_name: string, connection: Partial<ConnectionState> = {}, over: Partial<MemberSearchResult> = {}): MemberSearchResult {
  return {
    id, full_name, role: 'service_provider', avatar_url: null, location: 'Newtown', state: 'NSW', connection_status: null,
    rating_avg: null, review_count: 0, verified: false,
    connection: { user_id: id, state: 'none', connection_id: null, ...connection }, ...over,
  };
}

/** A person's card: the element around their name row. */
const card = (view: FakeElement, name: string) => getByName(view, 'h3', name).parentElement?.parentElement as FakeElement;

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.properties.listPublic.mockResolvedValue([]);
  mockApi.applications.listMine.mockResolvedValue([]);
  members.search.mockResolvedValue([]);
});
afterEach(cleanup);

describe('NetworkRecommendations people', () => {
  // This list used to send no rating, so a rating seen on a card was gone here.
  it("shows the rating and verified seal each person's profile shows", async () => {
    members.search.mockResolvedValue([
      member('amelia', 'Amelia Whitlock', {}, { rating_avg: 4.67, review_count: 3, verified: true }),
      member('mei', 'Mei Lin', {}, { role: 'tenant' }),
    ]);
    const view = await render(<NetworkRecommendations signedIn showProperties={false} />);

    const amelia = card(view, 'Amelia Whitlock');
    expect(textOf(amelia)).toContain('Rated 4.7 out of 5 from 3 reviews');
    expect(descendants(amelia).some((element) => element.getAttribute('aria-label') === 'Verified by TenantVoice')).toBe(true);
    const mei = card(view, 'Mei Lin');
    expect(textOf(mei)).toContain('No ratings yet');
    expect(descendants(mei).some((element) => element.getAttribute('role') === 'img')).toBe(false);
  });

  it('asks owners for landlords and tenants only', async () => {
    await render(<NetworkRecommendations signedIn showProperties={false} clientsOnly />);

    expect(members.search.mock.calls.map(([params]) => params)).toEqual([{ role: 'landlord', limit: 24 }, { role: 'tenant', limit: 24 }]);
  });

  it('offers each person the Connect button state their search sent, without a read per card', async () => {
    members.search.mockResolvedValue([
      member('mei', 'Mei Lin'),
      member('jon', 'Jon Doe', { state: 'sent', connection_id: 'r1' }),
      member('ava', 'Ava Agent', { state: 'received', connection_id: 'r2' }),
    ]);
    mockApi.connections.request.mockResolvedValue({ id: 'r3' });
    const view = await render(<NetworkRecommendations signedIn showProperties={false} />);

    expect(getByName(view, 'button', 'Withdraw your request to Jon Doe')).toBeTruthy();
    expect(getByName(view, 'button', "Accept Ava Agent's request")).toBeTruthy();
    await click(getByName(view, 'button', 'Connect with Mei Lin'));

    expect(mockApi.connections.request).toHaveBeenCalledWith('mei');
    expect(textOf(card(view, 'Mei Lin'))).toContain('Pending: request sent');
    expect(members.state).not.toHaveBeenCalled();
  });

  it('opens a conversation with a connection', async () => {
    members.search.mockResolvedValue([member('ava', 'Ava Agent', { state: 'connected', connection_id: 'r2' })]);
    mockApi.conversations.startRental.mockResolvedValue({ id: 'thread-1' });
    const view = await render(<NetworkRecommendations signedIn showProperties={false} messagesHref="/owner/messages" />);

    expect(textOf(card(view, 'Ava Agent'))).toContain('Connected');
    await click(getByName(view, 'button', 'Message Ava Agent'));

    expect(mockApi.conversations.startRental).toHaveBeenCalledWith({ peer_id: 'ava', subject: 'Chat with Ava Agent' });
    expect(navigation.push).toHaveBeenCalledWith('/owner/messages?thread=thread-1');
  });

  it('keeps the people cards at AA contrast, also under the pointer', async () => {
    members.search.mockResolvedValue([
      member('amelia', 'Amelia Whitlock', {}, { rating_avg: 5, review_count: 1, verified: true }),
      member('ava', 'Ava Agent', { state: 'connected', connection_id: 'r2' }),
    ]);
    const view = await render(<NetworkRecommendations signedIn showProperties={false} />);
    const cards = [card(view, 'Amelia Whitlock'), card(view, 'Ava Agent')];

    for (const person of cards) {
      expect(lowContrastText(person)).toEqual([]);
      expect(lowContrastText(hovered(person))).toEqual([]);
    }
  });
});

describe('NetworkRecommendations properties', () => {
  // The page used to filter and sort the first 24 public listings itself.
  it("shows the tenant's matches from the server instead of filtering public listings", async () => {
    matching.homes.mockResolvedValue({
      items: [{
        listing: {
          id: 'l1', title: 'Harbour flat', suburb: 'Newtown', state: 'NSW', postcode: '2042', property_type: 'apartment',
          price: 980, bedrooms: 2, bathrooms: 1, parking: 1, pet_friendly: true, available_from: null, photo_url: null,
          published_at: null,
        },
        score: 81, match_level: 'strong', reasons: ['In Newtown, NSW: one of your preferred areas'],
        unmet: ['$980 a week, $330 over your $650 budget'], landlord: null,
      }],
      filters: [], has_preferences: true, considered: 1, excluded: {}, excluded_total: 0, source: 'rules',
      ai_status: 'not_configured', message: null, generated_at: '2026-10-23T00:00:00Z', cached: false,
    });
    matching.landlords.mockResolvedValue({ items: [], has_preferences: true, generated_at: '2026-10-23T00:00:00Z' });
    const view = await render(<NetworkRecommendations signedIn />);

    expect(matching.homes).toHaveBeenCalledTimes(1);
    expect(mockApi.properties.listPublic).not.toHaveBeenCalled();
    expect(mockApi.applications.listMine).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Harbour flat');
    expect(textOf(view)).toContain('$980 a week, $330 over your $650 budget');
    // Price and bedroom filters were the browser's; the matches come from the saved preferences.
    expect(descendants(view).some((element) => element.getAttribute('aria-label') === 'Min')).toBe(false);
    expect(textOf(view)).toContain('Refine people');
  });

  it('keeps the matches when only the people suggestions fail, and retries those alone', async () => {
    members.search.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'))
      .mockResolvedValueOnce([member('amelia', 'Amelia Whitlock')]);
    matching.homes.mockResolvedValue({
      items: [{
        listing: {
          id: 'l1', title: 'Harbour flat', suburb: 'Newtown', state: 'NSW', postcode: '2042', property_type: 'apartment',
          price: 620, bedrooms: 2, bathrooms: 1, parking: 1, pet_friendly: true, available_from: null, photo_url: null,
          published_at: null,
        },
        score: 81, match_level: 'strong', reasons: [], unmet: [], landlord: null,
      }],
      filters: [], has_preferences: true, considered: 1, excluded: {}, excluded_total: 0, source: 'rules',
      ai_status: 'not_configured', message: null, generated_at: '2026-10-23T00:00:00Z', cached: false,
    });
    matching.landlords.mockResolvedValue({ items: [], has_preferences: true, generated_at: '2026-10-23T00:00:00Z' });
    const view = await render(<NetworkRecommendations signedIn />);

    expect(textOf(view)).toContain('Harbour flat');
    expect(textOf(view)).toContain('People suggestions could not be loaded');

    await click(getByName(view, 'button', 'Try again'));

    expect(textOf(view)).toContain('Amelia Whitlock');
    expect(textOf(view)).toContain('Harbour flat');
    expect(matching.homes).toHaveBeenCalledTimes(1);
  });

  it('asks for no matches where there are no properties to show', async () => {
    await render(<NetworkRecommendations signedIn showProperties={false} />);

    expect(matching.homes).not.toHaveBeenCalled();
    expect(matching.landlords).not.toHaveBeenCalled();
  });
});
