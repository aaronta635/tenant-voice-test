import { cleanup, render, textOf } from '@/app/components/ui/test-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OwnerVerificationPage from '@/app/(owner)/owner/profile/verification/page';
import TenantFormScreens from '@/app/components/tenant/TenantFormScreens';
import { getTenantScreen } from '@/app/lib/tenant-data';

const mockDocuments = vi.hoisted(() => ({ checklist: vi.fn() }));
vi.mock('@/app/lib/profile-documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/profile-documents')>()),
  documentsApi: mockDocuments,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { profiles: { me: vi.fn(async () => null) }, notifications: { list: vi.fn(async () => []) } },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const PASSPORT = {
  type: 'PASSPORT', label: 'Passport', description: 'A current passport.', group: 'identity', group_label: 'Identity',
  repeatable: false, required: true, kinds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockDocuments.checklist.mockResolvedValue({
    role: 'tenant', can_share: true, types: [PASSPORT], requirements: [], requirements_met: false, documents: [],
    account: { status: 'pending', rejection_reason: null, approved_at: null, account_rejected: false },
  });
});
afterEach(cleanup);

describe('the tenant ID screens', () => {
  it.each(['upload-passport', 'id-verification'])('%s lists the documents the server holds, not the old local pick', async (slug) => {
    localStorage.setItem('tv_tenant_profile_extras', JSON.stringify({ passport_name: 'old-passport.jpg' }));

    const view = await render(<TenantFormScreens screen={getTenantScreen(slug)!} />);

    expect(mockDocuments.checklist).toHaveBeenCalled();
    expect(textOf(view)).toContain('Not uploaded');
    expect(textOf(view)).toContain('Files you picked before were not uploaded');
    expect(textOf(view)).not.toContain('pending review');
    expect(textOf(view)).not.toContain('Documents stay on this device');
  });
});

describe('the owner verification page', () => {
  it('lists the landlord documents and clears the old local pick', async () => {
    localStorage.setItem('tv_owner_identity_document', 'licence.pdf');

    const view = await render(<OwnerVerificationPage />);

    expect(textOf(view)).toContain('Verification documents');
    expect(textOf(view)).toContain('Not uploaded');
    expect(textOf(view)).toContain('licence.pdf');
    expect(textOf(view)).not.toContain('status: pending review');
    expect(localStorage.getItem('tv_owner_identity_document')).toBeNull();
  });
});
