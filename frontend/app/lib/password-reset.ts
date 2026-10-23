/**
 * Password reset links. Supabase Auth's emailed link opens /reset-password
 * with the recovery session in the URL fragment (#access_token=…&type=recovery),
 * or with #error=…&error_code=otp_expired once it has expired or been used.
 */

/** Sign-up's minimum: the register page, and RegisterIn on the backend. */
export const MIN_PASSWORD_LENGTH = 8;

/** Supabase Auth sends one recovery email per address a minute at most. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Where a finished reset lands; the login page shows a notice for this reason. */
export const PASSWORD_UPDATED_LOGIN_HREF = '/login?reason=password-updated';

/** The recovery session's access token from the link, or null for an expired, used or broken link. */
export function recoveryTokenFrom(hash: string, search = ''): string | null {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  // A failed link is named in the fragment, and in the PKCE flow in the query too.
  const failed = [fragment, new URLSearchParams(search)].some((params) => params.has('error') || params.has('error_code'));
  const token = fragment.get('access_token');
  return !failed && token && fragment.get('type') === 'recovery' ? token : null;
}
