import type { BackendRole } from './api';
import type { SessionRole } from './session-role';

/** Each role's first-run setup, which ends on the role's dashboard (lib/onboarding for tenants and landlords). */
const ONBOARDING: Record<SessionRole, string> = {
  Provider: '/dashboard/onboarding',
  Owner: '/owner/onboarding',
  Client: '/tenant/onboarding',
};

/** Accept only local paths; reject URL parser backslash/control normalization. */
export function safeNextPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  let decoded = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (/[\\\x00-\x20\x7f]/.test(decoded) || decoded.startsWith('//')) return null;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch { return null; }
  }
  try {
    const origin = 'https://tenantvoice.invalid';
    const url = new URL(value, origin);
    if (url.origin !== origin) return null;
    // Dot segments can normalise "/a/..//evil.com" to "//evil.com", which a
    // browser reads as another host: check the result, not just the input.
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith('//') ? null : path;
  } catch { return null; }
}

/**
 * The account type a sign-in link asks for: its role, else the workspace its
 * return path is in. Marketplace pages serve every account type, and the
 * backend refuses a sign-in under the wrong one, so they preselect none.
 */
export function roleForSignIn(value: string | null, next: string | null): SessionRole | null {
  if (value === 'tenant' || value === 'Client') return 'Client';
  if (value === 'landlord' || value === 'Owner') return 'Owner';
  if (value === 'service_provider' || value === 'Provider') return 'Provider';
  const path = safeNextPath(next)?.split(/[?#]/)[0] ?? '';
  const within = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (within('/owner')) return 'Owner';
  if (within('/tenant')) return 'Client';
  if (within('/dashboard')) return 'Provider';
  return null;
}

/** Whether a return path is in the area, at its root or below it. */
function within(next: string | null, area: string): boolean {
  const path = safeNextPath(next)?.split(/[?#]/)[0] ?? '';
  return path === area || path.startsWith(`${area}/`);
}

/** Whether a return path is in the admin console, which staff sign in to without an account type. */
export function isAdminPath(next: string | null): boolean {
  return within(next, '/admin');
}

/** Whether a return path is in the Housing Portal, which officers sign in to as staff do. */
export function isHousingPath(next: string | null): boolean {
  return within(next, '/housing');
}

/**
 * A new account needs a type: the link's, else Tenant for someone who came from
 * booking a provider (those sign-in links name none), else Service provider.
 */
export function roleForSignUp(value: string | null, next: string | null): SessionRole {
  return roleForSignIn(value, next) ?? (safeNextPath(next)?.startsWith('/providers/') ? 'Client' : 'Provider');
}

/** Link between sign-in and sign-up that keeps the visitor's return path. */
export function authPageHref(page: '/login' | '/register', role: BackendRole | null, next: string | null): string {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  const path = safeNextPath(next);
  if (path) params.set('next', path);
  const query = params.toString();
  return query ? `${page}?${query}` : page;
}

/**
 * A new account starts with its role's onboarding. A task in its own
 * workspace, such as listing a property or adding a service, waits for it:
 * onboarding carries the task as `next` and resumes it once finished,
 * skipped or closed. A page outside every workspace, such as the provider
 * booking a visitor started, opens at once. A task in another role's
 * workspace is dropped for the account's own onboarding: that workspace
 * would only turn the new account away.
 */
export function registerLanding(role: SessionRole, next: string | null): string {
  const onboarding = ONBOARDING[role];
  const path = safeNextPath(next);
  if (!path) return onboarding;
  const workspace = roleForSignIn(null, path);
  if (workspace === role && path.split(/[?#]/)[0] !== onboarding) {
    return `${onboarding}?${new URLSearchParams({ next: path })}`;
  }
  return workspace && workspace !== role ? onboarding : path;
}
