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

/** Server: read active role from cookie (set at login/register). */
export async function getSessionRole(): Promise<SessionRole | null> {
  const { cookies } = await import('next/headers');
  return parseRole((await cookies()).get(ROLE_COOKIE)?.value);
}

export async function getRoleHomeHref(): Promise<string> {
  const role = await getSessionRole();
  return role ? ROLE_HOME[role] : '/';
}

/** Client: persist role for shell chrome on marketplace / public routes. */
export function setSessionRole(role: SessionRole) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('tv_role', role);
  document.cookie = `${ROLE_COOKIE}=${encodeURIComponent(role)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
}

export function clearSessionRole() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('tv_role');
  document.cookie = `${ROLE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}
