export type SessionRole = 'Client' | 'Provider' | 'Owner';

export const ROLE_COOKIE = 'tv_role';

export const ROLE_HOME: Record<SessionRole, string> = {
  Provider: '/dashboard',
  Owner: '/owner',
  Client: '/tenant/dashboard',
};

export function parseRole(value: string | undefined | null): SessionRole | null {
  if (value === 'Client' || value === 'Provider' || value === 'Owner') return value;
  return null;
}

/**
 * Staff have no workspace, so no SessionRole: an admin signs in to the admin
 * console, an officer to the Housing Portal. Their role cookie says 'Admin'
 * or 'Officer', which parseRole reads as no role, so no workspace shell,
 * redirect or sign-in tab takes them for a member.
 */
export type StaffRole = 'Admin' | 'Officer';

export const STAFF_HOME: Record<StaffRole, string> = { Admin: '/admin', Officer: '/housing' };

export function parseStaffRole(value: string | undefined | null): StaffRole | null {
  return value === 'Admin' || value === 'Officer' ? value : null;
}

/** Client: a stored JWT is usable until its exp claim (in seconds) passes. */
export function isUnexpiredJwt(token: string | null): boolean {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();
  } catch { return false; }
}

/** Server: read active role from cookie (set at login/register). */
export async function getSessionRole(): Promise<SessionRole | null> {
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  if (!jar.get('tv_token')?.value) return null;
  return parseRole(jar.get(ROLE_COOKIE)?.value);
}

export async function getRoleHomeHref(): Promise<string> {
  const role = await getSessionRole();
  return role ? ROLE_HOME[role] : '/';
}

/** Client: a session cookie string; Secure on HTTPS so the JWT never crosses plain HTTP. */
export function sessionCookie(name: string, value: string, maxAge: number): string {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

/** Client: persist role for shell chrome on marketplace / public routes. */
export function setSessionRole(role: SessionRole | StaffRole) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('tv_role', role);
  document.cookie = sessionCookie(ROLE_COOKIE, role, 60 * 60 * 24 * 7);
}

export function clearSessionRole() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('tv_role');
  document.cookie = sessionCookie(ROLE_COOKIE, '', 0);
}

/** Client: the stored role of a live session, unparsed; null when signed out. */
function clientRoleValue(): string | null {
  if (typeof window === 'undefined') return null;
  // Middleware trusts only the tv_token cookie; without it the mirror counts
  // only while its JWT is unexpired (a legacy session awaiting migration).
  const hasToken = document.cookie.split(';').some((part) => part.trim().startsWith('tv_token=')) || isUnexpiredJwt(localStorage.getItem('tv_token'));
  if (!hasToken) return null;
  const fromCookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ROLE_COOKIE}=`));
  if (fromCookie) return decodeURIComponent(fromCookie.slice(ROLE_COOKIE.length + 1));
  return localStorage.getItem('tv_role');
}

/** Client: read the role cookie / localStorage for in-app links. */
export function getClientSessionRole(): SessionRole | null {
  return parseRole(clientRoleValue());
}

/** Client: 'Admin' or 'Officer' while staff are signed in; the server still checks every staff request. */
export function getClientStaffRole(): StaffRole | null {
  return parseStaffRole(clientRoleValue());
}

export const ROLE_MESSAGES: Record<SessionRole, string> = {
  Client: '/tenant/messages',
  Owner: '/owner/messages',
  Provider: '/dashboard/messages',
};

export function messagesHrefForRole(role: SessionRole | null | undefined): string {
  return role ? ROLE_MESSAGES[role] : '/login';
}
