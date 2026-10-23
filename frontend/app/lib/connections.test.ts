import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConnectionState, runConnectionAction, searchMembers, type ConnectionState } from './connections';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), request: vi.fn(), respond: vi.fn(), remove: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  apiFetch: mocks.apiFetch,
  api: { connections: { request: mocks.request, respond: mocks.respond, remove: mocks.remove } },
}));

const MEI = 'c0000000-0000-4000-8000-000000000041';
const state = (name: ConnectionState['state'], connection_id: string | null = 'r1'): ConnectionState => ({ user_id: MEI, state: name, connection_id });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ id: 'r2' });
});

describe('connection reads', () => {
  it("reads the viewer's state with one member", async () => {
    await getConnectionState('not/a-path');
    expect(mocks.apiFetch).toHaveBeenCalledWith('/me/connections/with/not%2Fa-path');
  });

  it('searches members with the directory filters', async () => {
    await searchMembers({ search: 'mei', role: 'tenant', limit: 24 });
    expect(mocks.apiFetch).toHaveBeenCalledWith('/profiles/search', { query: { search: 'mei', role: 'tenant', limit: 24 } });
  });
});

describe('runConnectionAction', () => {
  it('sends a request and leaves it pending, with its id', async () => {
    expect(await runConnectionAction('connect', state('none', null))).toEqual(state('sent', 'r2'));
    expect(mocks.request).toHaveBeenCalledWith(MEI);
  });

  it('withdraws a sent request', async () => {
    expect(await runConnectionAction('withdraw', state('sent'))).toEqual(state('none', null));
    expect(mocks.remove).toHaveBeenCalledWith('r1');
  });

  it('accepts a request', async () => {
    expect(await runConnectionAction('accept', state('received'))).toEqual(state('connected'));
    expect(mocks.respond).toHaveBeenCalledWith('r1', 'accepted');
  });

  it('declines a request, leaving the person who declined free to ask', async () => {
    expect((await runConnectionAction('decline', state('received'))).state).toBe('none');
    expect(mocks.respond).toHaveBeenCalledWith('r1', 'declined');
  });

  it('refuses to answer a request it has no id for', async () => {
    await expect(runConnectionAction('accept', state('received', null))).rejects.toThrow('No request to accept');
    expect(mocks.respond).not.toHaveBeenCalled();
  });
});
