import { describe, expect, it, vi } from 'vitest';
import LeaseActivatedNotice from './agreements/activated/[agreementId]/page';
import LeaseSignedNotice from './applications/lease-signed/[agreementId]/page';
import LeaseReadyNotice from './documents/lease-ready/[agreementId]/[documentId]/page';

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => { throw new Error(`redirect ${href}`); }),
}));
vi.mock('next/navigation', () => navigation);

describe("the lease notices' links", () => {
  it.each([
    ['lease-signed, to the owner', () => LeaseSignedNotice({ params: Promise.resolve({ agreementId: 'lease-1' }) }), '/owner/leases/lease-1'],
    ['lease-ready, to the tenant', () => LeaseReadyNotice({ params: Promise.resolve({ agreementId: 'lease-1', documentId: 'doc-1' }) }), '/tenant/leases/lease-1'],
    ['activated, to the tenant', () => LeaseActivatedNotice({ params: Promise.resolve({ agreementId: 'lease-1' }) }), '/tenant/leases/lease-1'],
  ])('open the lease page: %s', async (_notice, open, href) => {
    await expect(open()).rejects.toThrow(`redirect ${href}`);
    expect(navigation.redirect).toHaveBeenLastCalledWith(href);
  });
});
