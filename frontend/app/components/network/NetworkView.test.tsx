import { cleanup, click, descendants, getByName, render, settle, surfaceStyle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { act, type ComponentProps, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Card from '@/app/components/ui/Card';
import { ApiError, type Connection, type ProfileSearchResult } from '@/app/lib/api';
import NetworkView from './NetworkView';

const mockApi = vi.hoisted(() => ({
  connections: { list: vi.fn(), respond: vi.fn(), remove: vi.fn(), request: vi.fn() },
  profiles: { search: vi.fn() },
  conversations: { startRental: vi.fn() },
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
  getAuthToken: () => 'token',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/app/components/ui/Card', async (importOriginal) => {
  const { default: RealCard } = await importOriginal<typeof import('@/app/components/ui/Card')>();
  return { default: (props: ComponentProps<typeof RealCard>) => <RealCard data-card="" {...props} /> };
});

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: 'c1', requester_id: 'lena', addressee_id: 'me', status: 'pending',
    created_at: '2026-10-20T01:00:00Z', responded_at: null,
    person_id: 'lena', person_name: 'Lena Landlord', person_role: 'landlord',
    person_avatar_url: null, person_location: 'Parramatta', direction: 'incoming',
    ...overrides,
  };
}

function dialog(view: FakeElement) {
  return descendants(view).find((element) => element.tagName === 'DIALOG') as FakeElement;
}

function renderNetwork() {
  return render(<NetworkView messagesHref="/dashboard/messages" searchHref="/dashboard/search-profiles" recommendationsHref="/dashboard/recommendations" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.profiles.search.mockResolvedValue([]);
});
afterEach(cleanup);

describe('NetworkView declining a request', () => {
  it('asks first and says the decline blocks new requests and messages', async () => {
    const request = connection({});
    mockApi.connections.list.mockResolvedValue([request]);
    mockApi.connections.respond.mockResolvedValue({ ...request, status: 'declined', responded_at: '2026-10-21T01:00:00Z' });
    const view = await renderNetwork();

    await click(getByName(view, 'button', 'Decline request from Lena Landlord'));
    expect(mockApi.connections.respond).not.toHaveBeenCalled();
    expect(dialog(view).hasAttribute('open')).toBe(true);
    expect(textOf(dialog(view))).toContain("can't message each other");
    expect(textOf(dialog(view))).toContain('Declined requests');
    // The server's rule: after a decline, only the person who declined may send a new request.
    expect(textOf(dialog(view))).toContain('only you can send a new request');
    expect(textOf(dialog(view))).not.toContain('Neither of you');

    await click(getByName(view, 'button', 'Keep request'));
    expect(dialog(view).hasAttribute('open')).toBe(false);
    expect(mockApi.connections.respond).not.toHaveBeenCalled();

    await click(getByName(view, 'button', 'Decline request from Lena Landlord'));
    await click(getByName(view, 'button', 'Decline request'));
    expect(mockApi.connections.respond).toHaveBeenCalledWith('c1', 'declined');
    expect(dialog(view).hasAttribute('open')).toBe(false);
    expect(getByName(view, 'button', 'Remove declined request from Lena Landlord')).toBeTruthy();
    expect(textOf(view)).toContain('Only you can send a new request while it is listed here');
    expect(textOf(view)).not.toContain('Neither of you');
  });

  it('lets the person who declined remove it so either side can ask again', async () => {
    mockApi.connections.list.mockResolvedValue([
      connection({ status: 'declined', responded_at: '2026-10-21T01:00:00Z' }),
      connection({ id: 'c2', requester_id: 'me', addressee_id: 'omar', person_id: 'omar', person_name: 'Omar Owner', status: 'declined', direction: 'outgoing' }),
    ]);
    mockApi.connections.remove.mockResolvedValue(undefined);
    const view = await renderNetwork();

    expect(textOf(view)).not.toContain('Omar Owner');
    await click(getByName(view, 'button', 'Remove declined request from Lena Landlord'));
    expect(mockApi.connections.remove).toHaveBeenCalledWith('c1');
    expect(textOf(view)).not.toContain('Declined requests');
    expect(textOf(view)).toContain('You or Lena Landlord can send a new connection request.');
  });
});

describe('NetworkView sent requests', () => {
  /** The words a sighted user sees on a control: its text without screen-reader-only spans. */
  function visibleText(element: FakeElement) {
    const hidden = descendants(element).filter((child) => child.className.split(/\s+/).includes('sr-only'));
    return hidden.reduce((text, child) => text.replace(textOf(child), ''), textOf(element)).trim();
  }

  it('names each Cancel button by the word it shows and the person the request went to', async () => {
    mockApi.connections.list.mockResolvedValue([
      connection({ id: 'c2', requester_id: 'me', addressee_id: 'omar', person_id: 'omar', person_name: 'Omar Owner', direction: 'outgoing' }),
      connection({ id: 'c3', requester_id: 'me', addressee_id: 'tia', person_id: 'tia', person_name: 'Tia Tenant', person_role: 'tenant', direction: 'outgoing' }),
    ]);
    mockApi.connections.remove.mockResolvedValue(undefined);
    const view = await renderNetwork();
    const cancel = getByName(view, 'button', 'Cancel request to Tia Tenant');

    expect(visibleText(cancel)).toBe('Cancel');
    expect(visibleText(getByName(view, 'button', 'Cancel request to Omar Owner'))).toBe('Cancel');
    await click(cancel);
    expect(mockApi.connections.remove).toHaveBeenCalledWith('c3');
  });
});

describe('NetworkView controls', () => {
  it('gives the connection sort control the same 44px target as the role filter', async () => {
    mockApi.connections.list.mockResolvedValue([connection({ status: 'accepted', responded_at: '2026-10-21T01:00:00Z' })]);
    const view = await renderNetwork();
    const heights = (name: string) => getByName(view, 'select', name).className.split(/\s+/).filter((utility) => /^(min-)?h-/.test(utility));

    expect(heights('Filter by role')).toEqual(['h-11']);
    expect(heights('Sort connections')).toEqual(['h-11']);
  });

  it('gives every card on the page the shared card style', async () => {
    mockApi.connections.list.mockResolvedValue([
      connection({}),
      connection({ id: 'c2', requester_id: 'me', addressee_id: 'omar', person_id: 'omar', person_name: 'Omar Owner', direction: 'outgoing' }),
      connection({ id: 'c3', requester_id: 'dev', person_id: 'dev', person_name: 'Dev Declined', status: 'declined', responded_at: '2026-10-21T01:00:00Z' }),
      connection({ id: 'c4', requester_id: 'ana', person_id: 'ana', person_name: 'Ana Accepted', status: 'accepted', responded_at: '2026-10-21T01:00:00Z' }),
    ]);
    mockApi.profiles.search.mockResolvedValue([{ id: 'sam', full_name: 'Sam Tenant', role: 'tenant', avatar_url: null, location: null, state: null, connection_status: null }]);
    const view = await renderNetwork();
    const plain = surfaceStyle((await render(<Card />)).children[0]);
    const cards = descendants(view).filter((element) => element.hasAttribute('data-card'));

    expect(textOf(view)).toContain('Declined requests');
    expect(textOf(view)).toContain('Sam Tenant');
    expect(cards).toHaveLength(9);
    expect(cards.map(surfaceStyle)).toEqual(cards.map(() => plain));
  });
});

describe('NetworkView empty state', () => {
  it('uses the shared empty state with a way to find people when there are no connections', async () => {
    mockApi.connections.list.mockResolvedValue([]);
    const view = await renderNetwork();
    const heading = getByName(view, 'h2', 'No connections yet');
    const findPeople = getByName(view, 'a', 'Find people');

    expect(heading.parentElement?.hasAttribute('data-card')).toBe(true);
    expect(findPeople.getAttribute('href')).toBe('/dashboard/search-profiles');
    expect(findPeople.hasAttribute('data-button-link')).toBe(true);
    expect(descendants(view).some((element) => element.getAttribute('aria-label') === 'Search your connections')).toBe(false);
  });
});

describe('NetworkView suggestions', () => {
  it('keeps requests and connections when suggestions fail, and retries only the suggestions', async () => {
    mockApi.connections.list.mockResolvedValue([
      connection({}),
      connection({ id: 'c4', requester_id: 'ana', person_id: 'ana', person_name: 'Ana Accepted', status: 'accepted', responded_at: '2026-10-21T01:00:00Z' }),
    ]);
    mockApi.profiles.search
      .mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'))
      .mockResolvedValue([{ id: 'sam', full_name: 'Sam Tenant', role: 'tenant', avatar_url: null, location: null, state: null, connection_status: null }]);
    const view = await renderNetwork();

    expect(textOf(view)).not.toContain('Could not load your network');
    expect(getByName(view, 'button', 'Accept request from Lena Landlord')).toBeTruthy();
    expect(getByName(view, 'button', 'Message Ana Accepted')).toBeTruthy();
    expect(textOf(view)).toContain('Could not load suggestions');

    await click(getByName(view, 'button', 'Try again loading suggestions'));
    expect(mockApi.connections.list).toHaveBeenCalledTimes(1);
    expect(mockApi.profiles.search).toHaveBeenCalledTimes(2);
    expect(textOf(view)).not.toContain('Could not load suggestions');
    expect(getByName(view, 'button', 'Connect with Sam Tenant')).toBeTruthy();
  });

  it('keeps focus in the suggestions card while they load again', async () => {
    mockApi.connections.list.mockResolvedValue([]);
    let deliver: (people: ProfileSearchResult[]) => void = () => {};
    mockApi.profiles.search
      .mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable. Please try again.'))
      .mockReturnValueOnce(new Promise<ProfileSearchResult[]>((resolve) => { deliver = resolve; }));
    const view = await renderNetwork();
    const heading = getByName(view, 'h2', 'People you may know');
    const card = heading.parentElement as FakeElement;
    const retry = getByName(card, 'button', 'Try again loading suggestions');
    retry.focus();
    await click(retry);

    // The retry button is gone, which would leave focus on the page body.
    expect(textOf(card)).toContain('Loading suggestions…');
    expect(document.activeElement).toBe(heading);

    await act(async () => { deliver([{ id: 'sam', full_name: 'Sam Tenant', role: 'tenant', avatar_url: null, location: null, state: null, connection_status: null }]); });
    await settle();
    expect(getByName(card, 'button', 'Connect with Sam Tenant')).toBeTruthy();
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });
});
