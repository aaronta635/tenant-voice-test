import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderMarkup } from '@/app/test-utils/static-markup';
import ContactPage from './contact/page';
import HowItWorksPage from './how-it-works/page';
import PublicPropertiesPage from './properties/page';
import RentalRightsPage from './rental-rights/page';

vi.mock('@/app/lib/session-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/session-role')>()),
  getSessionRole: async () => null,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { content: { supportContact: async () => ({ email: 'help@tenantvoice.invalid', phone: '02 9000 0000' }) } },
}));
// The listings render client-side; this test covers the page's own copy.
vi.mock('@/app/components/rental/PropertyMarketplace', () => ({ default: () => null }));

// Accounts are created as "Landlord", so public pages use that word for the role.
describe('public pages call the landlord role a landlord', () => {
  it.each<[string, () => Promise<ReactElement> | ReactElement]>([
    ['How it works', () => HowItWorksPage()],
    ['Rental rights', () => RentalRightsPage()],
    ['Rentals', () => PublicPropertiesPage({ searchParams: Promise.resolve({}) })],
    ['Contact', () => ContactPage({ searchParams: Promise.resolve({}) })],
  ])('%s never calls landlords owners', async (_page, render) => {
    const { text } = renderMarkup(await render());
    expect(text).toMatch(/\blandlords?\b/i);
    expect(text).not.toMatch(/\bowners?\b|\bown property\b/i);
  });
});
