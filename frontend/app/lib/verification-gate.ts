// The verification gates' refusals (backend services/gates.py, tracker R18).
// Applying, publishing a listing, paid AI, accepting bookings, taking on
// repairs and going live need an active, verified account. The server
// decides on every request; this only recognises its 403, or the refusal a
// response carries in `verification` when it answered without the action
// (matching and the provider assistant without the model), so a page can
// show VerificationRequired instead of a bare error.

import { ApiError } from './api';

/** The actions a gate guards. */
export type GatedAction = 'apply' | 'publish_listing' | 'paid_ai' | 'accept_booking' | 'receive_repairs' | 'go_live';

/**
 * Why the gate said no. Your own account: pending, rejected or unknown
 * (its verification), suspended or inactive (the account). Someone you hand
 * work to: unverified or unavailable.
 */
export type GateStatus = 'pending' | 'rejected' | 'unknown' | 'suspended' | 'inactive' | 'unverified' | 'unavailable';

export type VerificationRequiredDetail = {
  code: 'verification_required';
  action: string;
  status: GateStatus | string;
  /** A sentence for the person, in the action's words. */
  message: string;
  /** The documents page of their role, while documents can change the answer; null otherwise. */
  documents_href: string | null;
};

export const VERIFICATION_REQUIRED = 'verification_required';

/** A path on this site; anything else (another origin, a script URL) is no link at all. */
function sitePath(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : null;
}

/** A gate's refusal, as an error's detail or a response's `verification` holds it; null for anything else. */
export function refusalOf(value: unknown): VerificationRequiredDetail | null {
  if (typeof value !== 'object' || value === null) return null;
  const { code, action, status, message, documents_href: href } = value as Record<string, unknown>;
  if (code !== VERIFICATION_REQUIRED || typeof action !== 'string' || typeof status !== 'string') return null;
  if (typeof message !== 'string' || !message.trim()) return null;
  return { code: VERIFICATION_REQUIRED, action, status, message, documents_href: sitePath(href) };
}

/** The gate's refusal an API error carries; null for any other error. */
export function verificationRequired(error: unknown): VerificationRequiredDetail | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  return refusalOf(error.detail);
}
