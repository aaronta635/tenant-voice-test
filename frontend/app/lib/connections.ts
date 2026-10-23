// The Connect button's data (R24): the signed-in viewer's state with one
// member, and the member search that sends each person's state, rating and
// verified badge. The server decides every state (tracker assumption #3,
// backend/app/services/connections.py), so the button only offers what the
// state it was given allows.

import { api, apiFetch, type Connection, type ProfileSearchResult } from './api';

/**
 * self: the viewer's own profile. unavailable: staff, an account that is not
 * an active member, or a pair blocked in the mobile app. none: the viewer may
 * send a request. sent: theirs waits, and they may withdraw it. received:
 * they may accept or decline. declined: the other declined their request, and
 * only the other may send a new one.
 */
export type ConnectionStateName = 'self' | 'unavailable' | 'none' | 'sent' | 'received' | 'connected' | 'declined';

export type ConnectionState = {
  user_id: string;
  state: ConnectionStateName;
  /** The request the state comes from, to answer or withdraw it. */
  connection_id: string | null;
};

/** A /profiles/search result: the directory fields, the badges the person's profile shows and the viewer's state. */
export type MemberSearchResult = ProfileSearchResult & {
  /** From published and flagged reviews; null until there is one. */
  rating_avg: number | null;
  review_count: number;
  verified: boolean;
  connection: ConnectionState;
};

export function getConnectionState(userId: string): Promise<ConnectionState> {
  return apiFetch<ConnectionState>(`/me/connections/with/${encodeURIComponent(userId)}`);
}

export function searchMembers(params: { search?: string; role?: string; limit?: number } = {}): Promise<MemberSearchResult[]> {
  return apiFetch<MemberSearchResult[]>('/profiles/search', { query: params });
}

export type ConnectionAction = 'connect' | 'withdraw' | 'accept' | 'decline';

/**
 * Runs an action, and returns the state it leaves. A decline leaves the
 * person who declined free to ask again, so their state is none.
 */
export async function runConnectionAction(action: ConnectionAction, current: ConnectionState): Promise<ConnectionState> {
  const id = current.connection_id;
  if (action === 'connect') {
    const sent: Connection = await api.connections.request(current.user_id);
    return { ...current, state: 'sent', connection_id: sent.id };
  }
  if (!id) throw new Error(`No request to ${action}`);
  if (action === 'withdraw') {
    await api.connections.remove(id);
    return { ...current, state: 'none', connection_id: null };
  }
  await api.connections.respond(id, action === 'accept' ? 'accepted' : 'declined');
  return { ...current, state: action === 'accept' ? 'connected' : 'none' };
}
