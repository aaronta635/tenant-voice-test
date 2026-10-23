// A lease as the API answers it (backend schemas/leases.LeaseOut), for the lease tests.
import type { Lease } from '@/app/lib/leases';

export const CONSENT = { text: 'I have read the lease PDF shown to me in TenantVoice and I agree to its terms.', version: 'v1' };

export function lease(over: Partial<Lease> = {}): Lease {
  return {
    id: 'lease-1', application_id: 'app-1', listing_id: 'pr-1', title: 'Harbour flat', address: '12 Harbour Street, Wollongong NSW 2500',
    bond_amount: 2600, tenant: { id: 'tenant-1', name: 'Tanya Tenant' }, owner: { id: 'owner-1', name: 'Olivia Owner' },
    rent_amount: 650, rent_frequency: 'WEEKLY', currency: 'AUD', start_date: '2026-11-15', end_date: '2027-11-14',
    first_due_date: '2026-11-15', status: 'draft', stage: 'review', tenant_confirmed_at: null, activated_at: null,
    created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z',
    document: { id: 'doc-1', filename: 'Residential tenancy agreement.pdf', version: 1, created_at: '2026-10-21T00:00:00Z' },
    tenant_signature: null, owner_signature: null, viewer_role: 'tenant',
    actions: { send_document: false, confirm: true, sign: false, owner_sign: false, activate: false },
    consent: CONSENT,
    ...over,
  };
}

export const SIGNATURE = {
  signer_name: 'Tanya Tenant', signed_at: '2026-10-22T01:00:00Z', document_id: 'doc-1',
  document_sha256: 'a'.repeat(64), consent_version: 'v1',
};
