import { beforeEach, describe, expect, it, vi } from 'vitest';
import { roleForSignIn, safeNextPath } from '@/app/lib/auth-redirect';
import type { SessionRole } from '@/app/lib/session-role';
import { renderMarkup } from '@/app/test-utils/static-markup';
import ContactPage from './page';

const session = vi.hoisted(() => ({ role: null as SessionRole | null, email: 'help@tenantvoice.invalid' as string | undefined }));
vi.mock('@/app/lib/session-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/session-role')>()),
  getSessionRole: async () => session.role,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { content: { supportContact: async () => ({ email: session.email, phone: '02 9000 0000' }) } },
}));

const supportLink = { href: 'mailto:help@tenantvoice.invalid', text: 'email support with the relevant property or booking details' };

async function contactPage() {
  return renderMarkup(await ContactPage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  session.role = null;
  session.email = 'help@tenantvoice.invalid';
});

describe('Contact formal issue guidance', () => {
  it('sends a signed-out renter to sign in as a tenant and lodge a tracked complaint', async () => {
    const { links } = await contactPage();
    const signIn = links.find((link) => link.href.startsWith('/login'));
    expect(signIn?.text).toBe('Sign in as a tenant to lodge a tracked complaint');
    const url = new URL(signIn!.href, 'https://tenantvoice.invalid');
    expect(roleForSignIn(url.searchParams.get('role'), url.searchParams.get('next'))).toBe('Client');
    expect(safeNextPath(url.searchParams.get('next'))).toBe('/tenant/complaints');
    expect(links).toContainEqual(supportLink);
  });

  it('keeps signed-in tenants on their complaints page, where they can lodge one', async () => {
    session.role = 'Client';
    const { links } = await contactPage();
    expect(links).toContainEqual({ href: '/tenant/complaints', text: 'lodge a tracked complaint' });
    expect(links).not.toContainEqual(supportLink);
  });

  it.each([
    ['Owner', '/owner/complaints'],
    ['Provider', '/dashboard/complaints'],
  ] as const)('sends a signed-in %s to support and labels their complaints page as complaints about them', async (role, againstMe) => {
    session.role = role;
    const { links, text } = await contactPage();
    expect(text).toContain('To raise a formal issue, email support with the relevant property or booking details');
    expect(links).toContainEqual(supportLink);
    expect(links.filter((link) => link.href === againstMe)).toEqual([{ href: againstMe, text: 'Complaints about you' }]);
    expect(links.some((link) => link.href === '/tenant/complaints' || link.href.startsWith('/login'))).toBe(false);
  });

  it('points to the support details when no support email is configured', async () => {
    session.role = 'Owner';
    session.email = undefined;
    expect((await contactPage()).text).toContain('To raise a formal issue, use the support contact details above when available.');
  });
});
