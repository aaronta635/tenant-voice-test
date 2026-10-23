// Staff sign-in. Admin and officer accounts cannot register: the TenantVoice
// team makes them, and they sign in without picking an account type, so the
// backend signs them in as what their users row says. Only the server decides
// who is an admin (GET /admin/*) or an officer (GET /housing/*); this only
// keeps the session.

import { clearAuthSession, setAuthToken, setRefreshToken } from './api';
import { isAdminPath, isHousingPath, safeNextPath } from './auth-redirect';
import { STAFF_HOME, setSessionRole, type StaffRole } from './session-role';

/** The backend role (ProfileOut.role) of an account that uses the admin console. */
export const ADMIN_ROLE = 'admin';
/** The backend role of a Housing Portal officer (the shared REGULATOR). */
export const OFFICER_ROLE = 'officer';

/** The staff role a backend role signs in as; null for a member. */
export function staffRoleOf(role: string): StaffRole | null {
  if (role === ADMIN_ROLE) return 'Admin';
  if (role === OFFICER_ROLE) return 'Officer';
  return null;
}

/** The staff sign-in, returning to a staff page afterwards when one is given. */
export function staffSignInHref(next?: string | null): string {
  const path = safeNextPath(next ?? null);
  return path ? `/login?${new URLSearchParams({ account: 'staff', next: path })}` : '/login?account=staff';
}

/**
 * Where staff land after signing in: the page of their own area they asked
 * for, else its home. An admin opens the console, an officer the Housing Portal.
 */
export function staffLanding(next: string | null, role: StaffRole = 'Admin'): string {
  const own = role === 'Officer' ? isHousingPath(next) : isAdminPath(next);
  return own ? (safeNextPath(next) as string) : STAFF_HOME[role];
}

/**
 * Keep a staff session as setAuthSession keeps a member's, which takes a
 * workspace role only. clearAuthSession first moves the session epoch on and
 * drops a pending expiry notice, as setAuthSession does for a new sign-in.
 */
export function startStaffSession(token: string, refreshToken?: string | null, role: StaffRole = 'Admin') {
  clearAuthSession();
  setAuthToken(token);
  setRefreshToken(refreshToken);
  if (typeof window === 'undefined') return;
  localStorage.removeItem('tv_explicit_logout');
  setSessionRole(role);
  window.dispatchEvent(new Event('tenantvoice:session-restored'));
}
