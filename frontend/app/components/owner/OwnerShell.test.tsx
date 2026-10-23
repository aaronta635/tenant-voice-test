import { cleanup, descendants, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { isPageRoute } from '@/app/test-utils/app-routes';
import { TENANT_NAV } from '@/app/lib/tenant-data';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OwnerShell from './OwnerShell';

const mocks = vi.hoisted(() => ({ owner: vi.fn(), ownerBadges: vi.fn(), pathname: '/owner/properties' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    profiles: { me: async () => ({ id: 'user-1', full_name: 'Morgan Lee', role: 'owner' }) },
    dashboard: { owner: mocks.owner, ownerBadges: mocks.ownerBadges },
    conversations: { list: async () => [] },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = '/owner/properties';
  mocks.ownerBadges.mockResolvedValue({ new_application_count: 3, unread_messages: 0, pending_connections: 2, unread_notifications: 0 });
});
afterEach(cleanup);

describe('the owner shell', () => {
  it("counts its badges with their own call, not the whole dashboard, on every page", async () => {
    const view = await render(<OwnerShell><p>Page</p></OwnerShell>);

    expect(mocks.ownerBadges).toHaveBeenCalledTimes(1);
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(textOf(getByName(view, 'a', /^Applications/))).toBe('Applications3');
    expect(textOf(getByName(view, 'a', /^Network/))).toBe('Network2');
  });

  it('links to the inspections, leases and rent ledger pages', async () => {
    const view = await render(<OwnerShell><p>Page</p></OwnerShell>);
    const links = new Map(descendants(view).filter((element) => element.tagName === 'A')
      .map((element) => [textOf(element), element.getAttribute('href')]));

    expect([links.get('Inspections'), links.get('Leases'), links.get('Rent ledger')]).toEqual([
      '/owner/inspections', '/owner/leases', '/owner/rent']);
    for (const href of ['/owner/inspections', '/owner/leases', '/owner/rent']) expect(isPageRoute(href), href).toBe(true);
  });
});

describe('the tenant menu', () => {
  it('links to the inspections, leases and rent pages', () => {
    const links = new Map<string, string>(TENANT_NAV.map((item) => [item.label, item.href]));

    expect([links.get('Inspections'), links.get('Leases'), links.get('My rent')]).toEqual([
      '/tenant/inspections', '/tenant/leases', '/tenant/rent']);
    for (const href of ['/tenant/inspections', '/tenant/leases', '/tenant/rent']) expect(isPageRoute(href), href).toBe(true);
  });
});

describe('the owner navigation', () => {
  // The request notice is the only other way in, and an owner who switched review notices off gets none.
  it('links to the scorecard requests tenants sent', async () => {
    const view = await render(<OwnerShell><p>Page</p></OwnerShell>);

    const link = getByName(view, 'a', 'Scorecards');
    expect(link.getAttribute('href')).toBe('/owner/scorecard');
    expect(descendants(view).filter((element) => element.tagName === 'NAV').some((nav) => textOf(nav).includes('Scorecards'))).toBe(true);
  });

  it('marks the scorecards item as the page open', async () => {
    mocks.pathname = '/owner/scorecard';
    const view = await render(<OwnerShell><p>Page</p></OwnerShell>);

    expect(getByName(view, 'a', 'Scorecards').className).toContain('bg-primary');
  });
});
