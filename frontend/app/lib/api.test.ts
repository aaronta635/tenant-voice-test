import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtExpiringIn } from './test-browser';

type ApiModule = typeof import('./api');
let api: ApiModule;
let storage: Map<string, string>;
let cookies: Map<string, string>;
let cookieWrites: string[];
let page: { protocol: string };
let events: EventTarget;
let fetchMock: ReturnType<typeof vi.fn>;

function response(status: number, body: unknown = { detail: 'Unauthorized' }) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  storage = new Map();
  cookies = new Map();
  cookieWrites = [];
  page = { protocol: 'https:' };
  events = new EventTarget();
  vi.stubGlobal('window', Object.assign(events, { location: page }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('document', {
    get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
    set cookie(value: string) {
      cookieWrites.push(value);
      const [pair] = value.split(';');
      const separator = pair.indexOf('=');
      const key = pair.slice(0, separator), content = pair.slice(separator + 1);
      if (/max-age=0(?:;|$)/.test(value)) cookies.delete(key); else cookies.set(key, content);
    },
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  api = await import('./api');
  api.setAuthSession('expired-access', 'Provider');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('session recovery', () => {
  it('announces expiry once and leaves unrelated draft storage untouched', async () => {
    const expired = vi.fn(); events.addEventListener('tenantvoice:session-expired', expired);
    storage.set('draft:thread-a', 'Private draft');
    fetchMock.mockImplementation(() => Promise.resolve(response(401)));
    await expect(api.apiFetch('/me/provider')).rejects.toMatchObject({ status: 401 });
    expect(api.getSessionRecovery()).toMatchObject({ role: 'Provider' });
    expect(api.getAuthToken()).toBeNull();
    expect(storage.get('draft:thread-a')).toBe('Private draft');
    await expect(api.apiFetch('/me/provider')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('opens recovery when a refreshed token is also rejected, without looping refresh', async () => {
    api.setRefreshToken('refresh-a');
    fetchMock.mockImplementation((url: string) => Promise.resolve(url.endsWith('/auth/refresh')
      ? response(200, { access_token: 'refreshed-access', refresh_token: 'refresh-b' }) : response(401)));
    await expect(api.apiFetch('/me/provider')).rejects.toMatchObject({ status: 401 });
    expect(api.getSessionRecovery()).toMatchObject({ role: 'Provider' });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1);
    expect(fetchMock.mock.calls).toHaveLength(3);
  });

  it('shares one refresh across simultaneous protected requests and retries with the rotated token', async () => {
    api.setRefreshToken('refresh-a');
    const refresh = deferred<Response>();
    fetchMock.mockImplementation((url: string, options: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return refresh.promise;
      return Promise.resolve((options.headers as Record<string, string>).Authorization === 'Bearer refreshed-access'
        ? response(200, { ok: true }) : response(401));
    });
    const requests = Promise.all([api.apiFetch('/me/provider'), api.apiFetch('/me/conversations')]);
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1));
    refresh.resolve(response(200, { access_token: 'refreshed-access', refresh_token: 'refresh-b' }));
    await expect(requests).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(api.getAuthToken()).toBe('refreshed-access');
    expect(api.getSessionRecovery()).toBeNull();
  });

  it('does not expire a newer login when an old request finishes with 401', async () => {
    const stale = deferred<Response>();
    fetchMock.mockReturnValue(stale.promise);
    const oldRequest = api.apiFetch('/me/provider');
    api.setAuthSession('new-account-access', 'Owner', 'new-account-refresh');
    stale.resolve(response(401));
    await expect(oldRequest).rejects.toMatchObject({ status: 401 });
    expect(api.getAuthToken()).toBe('new-account-access');
    expect(api.getSessionRecovery()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect credentials when a refresh finishes after sign out', async () => {
    api.setRefreshToken('refresh-a');
    const refresh = deferred<Response>();
    fetchMock.mockImplementation((url: string) => url.endsWith('/auth/refresh') ? refresh.promise : Promise.resolve(response(401)));
    const pending = api.apiFetch('/me/provider');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    api.clearAuthSession();
    refresh.resolve(response(200, { access_token: 'must-not-restore', refresh_token: 'must-not-store' }));
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(api.getAuthToken()).toBeNull();
    expect(api.getRefreshToken()).toBeNull();
    expect(api.getSessionRecovery()).toBeNull();
  });

  it('keeps a readable expiry snapshot for late subscribers and clears it on reauthentication', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response(401)));
    await expect(api.apiFetch('/me/provider')).rejects.toMatchObject({ status: 401 });
    const snapshot = api.getSessionRecovery();
    expect(snapshot).not.toBeNull();
    expect(api.getSessionRecovery()).toBe(snapshot);
    const update = vi.fn(); const unsubscribe = api.subscribeToSessionRecovery(update);
    api.setAuthSession('new-access', 'Provider');
    expect(api.getSessionRecovery()).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('refreshes a token a public page answered as signed out, and asks again once', async () => {
    api.setRefreshToken('refresh-a');
    fetchMock.mockImplementation((url: string, options: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return Promise.resolve(response(200, { access_token: 'refreshed-access', refresh_token: 'refresh-b' }));
      const signedIn = (options.headers as Record<string, string>).Authorization === 'Bearer refreshed-access';
      return Promise.resolve(signedIn ? response(200, { viewer: { role: 'tenant' } })
        : new Response(JSON.stringify({ viewer: { role: null } }), { status: 200, headers: { 'X-Session-Expired': '1' } }));
    });

    await expect(api.apiFetch('/properties/pr-1')).resolves.toEqual({ viewer: { role: 'tenant' } });
    expect(api.getAuthToken()).toBe('refreshed-access');
    expect(fetchMock.mock.calls.map(([url]) => String(url).replace(/^.*\/api\/v1/, ''))).toEqual([
      '/properties/pr-1', '/auth/refresh', '/properties/pr-1',
    ]);
  });

  it('keeps the signed-out answer when the session cannot be refreshed, without asking again', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ viewer: { role: null } }), { status: 200, headers: { 'X-Session-Expired': '1' } }),
    ));

    await expect(api.apiFetch('/properties/pr-1')).resolves.toEqual({ viewer: { role: null } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.getSessionRecovery()).toBeNull();
  });

  it.each([{ path: '/auth/login', options: { auth: false } }, { path: '/public', options: { auth: false } }, { path: '/protected', options: { token: 'server-token' } }])('does not clear local auth for $path', async ({ path, options }) => {
    fetchMock.mockImplementation(() => Promise.resolve(response(401)));
    await expect(api.apiFetch(path, options)).rejects.toMatchObject({ status: 401 });
    expect(api.getAuthToken()).toBe('expired-access');
    expect(api.getSessionRecovery()).toBeNull();
  });
});

describe('stored token liveness', () => {
  it('ignores an expired localStorage token once the session cookie has gone', () => {
    cookies.clear();
    storage.set('tv_token', jwtExpiringIn(-8 * 24 * 60 * 60));
    expect(api.getAuthToken()).toBeNull();
  });

  it('keeps an unexpired mirror for migration and always prefers the cookie', () => {
    cookies.clear();
    const mirror = jwtExpiringIn(3600);
    storage.set('tv_token', mirror);
    expect(api.getAuthToken()).toBe(mirror);
    cookies.set('tv_token', 'cookie-access');
    expect(api.getAuthToken()).toBe('cookie-access');
  });

  it('renews the role cookie together with a refreshed token', async () => {
    api.setRefreshToken('refresh-a');
    cookies.delete('tv_role');
    fetchMock.mockImplementation((url: string, options: RequestInit) => Promise.resolve(url.endsWith('/auth/refresh')
      ? response(200, { access_token: 'refreshed-access', refresh_token: 'refresh-b' })
      : (options.headers as Record<string, string>).Authorization === 'Bearer refreshed-access' ? response(200, { ok: true }) : response(401)));
    await expect(api.apiFetch('/me/provider')).resolves.toEqual({ ok: true });
    expect(cookies.get('tv_token')).toBe('refreshed-access');
    expect(cookies.get('tv_role')).toBe('Provider');
  });
});

describe('session cookies', () => {
  const sessionWrites = () => cookieWrites.filter((value) => /^tv_(token|role)=/.test(value));

  it('marks the token and role cookies Secure on HTTPS, also when clearing them', () => {
    cookieWrites = [];
    api.setAuthSession('access', 'Client', 'refresh');
    api.clearAuthSession();
    expect(sessionWrites()).toHaveLength(4);
    for (const value of sessionWrites()) expect(value).toMatch(/; Secure$/);
  });

  it('leaves Secure off for plain-HTTP local development', () => {
    page.protocol = 'http:';
    cookieWrites = [];
    api.setAuthSession('access', 'Client', 'refresh');
    expect(sessionWrites()).toHaveLength(2);
    for (const value of sessionWrites()) expect(value).not.toContain('Secure');
    expect(api.getAuthToken()).toBe('access');
  });
});

describe('friendly API failures', () => {
  it('keeps network and HTML/500 failures readable', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));
    await expect(api.apiFetch('/public', { auth: false })).rejects.toMatchObject({ status: 0, message: 'Could not connect. Check your connection and try again.' });
    expect(api.friendlyApiError(500, { detail: 'Internal query failed with secret connection details' })).toBe('The service is temporarily unavailable. Please try again.');
    expect(api.friendlyApiError(400, '<html>Bad request</html>')).not.toContain('<html>');
    expect(api.friendlyApiError(422, { detail: [{ loc: ['body', 'scheduled_date'], msg: 'Choose a future date' }] })).toBe('scheduled date: Choose a future date');
  });
});
