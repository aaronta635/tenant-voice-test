import { cleanup, click, descendants, getByName, render, type FakeElement } from '@/app/components/ui/test-dom';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OwnerShell from './owner/OwnerShell';
import TenantShell from './tenant/TenantShell';

vi.mock('next/navigation', () => ({ usePathname: () => '/owner', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    profiles: { me: async () => ({ id: 'user-1', full_name: 'Morgan Lee', role: 'owner' }) },
    dashboard: { owner: async () => null, ownerBadges: async () => null },
    conversations: { list: async () => [] },
  },
}));

afterEach(cleanup);

/** axe's aria-required-children rule: a role="menu" may own only menu items. */
function controlsThatAreNotMenuItems(menu: FakeElement) {
  return descendants(menu).filter((element) => ['A', 'BUTTON'].includes(element.tagName) && element.getAttribute('role') !== 'menuitem');
}

describe.each([
  ['owner', OwnerShell],
  ['tenant', TenantShell],
] as [string, ComponentType<{ children: ReactNode }>][])('the %s account menu', (_workspace, Shell) => {
  it('marks Sign out as a menu item, like the other links in the menu', async () => {
    const view = await render(<Shell><p>Page</p></Shell>);
    await click(getByName(view, 'button', 'Account menu'));
    const menu = descendants(view).find((element) => element.getAttribute('role') === 'menu') as FakeElement;

    expect(getByName(menu, 'a', 'Sign out').getAttribute('role')).toBe('menuitem');
    expect(controlsThatAreNotMenuItems(menu)).toEqual([]);
  });

  it('leaves the sidebar Sign Out, which is not in a menu, a plain link', async () => {
    const view = await render(<Shell><p>Page</p></Shell>);

    expect(getByName(view, 'a', 'Sign Out').hasAttribute('role')).toBe(false);
  });
});
