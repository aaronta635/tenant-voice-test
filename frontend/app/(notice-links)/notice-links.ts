// The links the shared database's lease triggers put in notifications are the
// mobile app's routes (output/shared-catalog/functions/notify_*.sql). These
// pages send each one to the web page for the same lease.

/** The lease page a notice opens, for the person it went to. */
export function leaseHref(role: 'owner' | 'tenant', agreementId: string): string {
  return `/${role}/leases/${encodeURIComponent(agreementId)}`;
}
