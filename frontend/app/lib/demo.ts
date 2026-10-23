// The fixed fictional accounts supabase/seed.sql creates, by id prefix: six
// providers (a…), nine tenants (b…), seven landlords (c…) and one admin (d…).
// scripts/seed_provider_demo.py writes its walkthrough rows between them, and
// demo users recreated on a copy of the shared project keep these ids
// (docs/demo-features.md).
const DEMO_ACCOUNTS: Record<string, number> = { a: 6, b: 9, c: 7, d: 1 };
const DEMO_ID = /^([a-d])0000000-0000-4000-8000-0{11}([1-9])$/;

/** Fixed fictional provider accounts created by supabase/seed.sql. */
export function isDemoProvider(profileId: string | null | undefined): boolean {
  return /^a0000000-0000-4000-8000-00000000000[1-6]$/.test(profileId ?? '');
}

/** Any of the fixed fictional accounts above, whatever its role. */
export function isDemoAccount(profileId: string | null | undefined): boolean {
  const match = DEMO_ID.exec(profileId ?? '');
  return !!match && Number(match[2]) <= DEMO_ACCOUNTS[match[1]];
}

/**
 * An address on a domain kept for examples (RFC 2606), such as the seeded
 * support@tenantvoice.test: nothing sent to it is ever received.
 */
export function isSampleEmail(email: string | null | undefined): boolean {
  return /@(?:[^@\s]+\.)?(?:test|example|invalid|localhost)$|@example\.(?:com|net|org)$/i.test(email?.trim() ?? '');
}

// The support numbers the web falls back to (backend services/content.py)
// and seeds (supabase/shared/0002_web_seed.sql): nobody answers them.
const SAMPLE_PHONES = new Set(['1800000000', '1800836268']);

/** One of those sample support numbers, however it is spaced. */
export function isSamplePhone(phone: string | null | undefined): boolean {
  return SAMPLE_PHONES.has((phone ?? '').replace(/\D/g, ''));
}

/** The Demo reason for a support contact, naming only its placeholder parts; null when both are real. */
export function sampleContactReason(contact: { email?: string | null; phone?: string | null } | null | undefined): string | null {
  const email = isSampleEmail(contact?.email);
  const phone = isSamplePhone(contact?.phone);
  if (email && phone) {
    return 'Sample support contact: the email address and phone number are placeholders, so messages sent to them are not received.';
  }
  if (email) return 'Sample support contact: the email address is a placeholder, so messages sent to it are not received.';
  if (phone) return 'Sample support contact: the phone number is a placeholder, so nobody answers it.';
  return null;
}
