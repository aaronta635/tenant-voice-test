import { cleanup, click, descendants, FakeElement, fire, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { act, type ComponentType, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OwnerShell from '@/app/components/owner/OwnerShell';
import ProviderShell from '@/app/components/provider/ProviderShell';
import TenantShell from '@/app/components/tenant/TenantShell';
import type { SessionRole } from '@/app/lib/session-role';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';

// Signed-in members see public pages inside their workspace ((public)/layout),
// so each workspace header carries the List menu the public header has.
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePathname: () => useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.location.pathname),
    useRouter: () => ({ push: (href: string) => navigation.page.navigate(href) }),
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: {
    profiles: { me: async () => null },
    providers: { mine: async () => null },
    dashboard: { owner: async () => null, ownerBadges: async () => null },
    conversations: { list: async () => [] },
    notifications: { list: async () => [] },
    connections: { list: async () => [] },
  },
}));

const SHELLS: [SessionRole, ComponentType<{ children: ReactNode }>][] = [
  ['Client', TenantShell],
  ['Owner', OwnerShell],
  ['Provider', ProviderShell],
];
const SHELL_OF = Object.fromEntries(SHELLS) as Record<SessionRole, ComponentType<{ children: ReactNode }>>;

let leavePage = () => {};
beforeEach(() => {
  navigation.page = createFakeHistory('/');
  leavePage = navigation.page.install(window);
  phone(false);
});
afterEach(async () => {
  await cleanup();
  leavePage();
  document.cookie = '';
  delete (FakeElement.prototype as { getClientRects?: unknown }).getClientRects;
});

/**
 * The provider workspace asks whether the viewport is desktop width. On a
 * phone its drawer traps focus among elements with a box, and the test DOM
 * lays out none, so every element gets one.
 */
function phone(narrow: boolean) {
  Object.assign(window, { matchMedia: () => ({ matches: !narrow, addEventListener() {}, removeEventListener() {} }) });
  if (narrow) Object.defineProperty(FakeElement.prototype, 'getClientRects', { configurable: true, value: () => [{}] });
}

async function workspace(role: SessionRole) {
  document.cookie = `tv_token=live-access; tv_role=${role}`;
  const Shell = SHELL_OF[role];
  return render(<Shell><p>Page</p></Shell>);
}

const barButton = (root: FakeElement) => getByName(root, 'button', 'List your service or property');
const panelButton = (root: FakeElement) => getByName(root, 'button', 'List on TenantVoice');
const inside = (element: FakeElement, tag: string) => {
  for (let node: FakeElement | null = element; node; node = node.parentElement) if (node.tagName === tag) return node;
  return null;
};
const classes = (element: FakeElement | null) => String(element?.className ?? '').split(/\s+/);
const option = (root: FakeElement, label: string) =>
  descendants(root).find((element) => element.getAttribute('role') === 'menuitem' && textOf(element).startsWith(label)) as FakeElement;
const notice = (root: FakeElement) =>
  descendants(root).find((element) => element.getAttribute('aria-labelledby')?.endsWith('-notice-title')) as FakeElement;
const drawer = (root: FakeElement) => inside(panelButton(root), 'ASIDE') as FakeElement;
const press = (target: FakeElement, key: string) => act(async () => { fire(target, 'keydown', { key }); });

describe('the List menu in signed-in workspaces', () => {
  it.each(SHELLS.map(([role]) => role))('%s workspace offers it in the header from sm up and in the navigation drawer below sm', async (role) => {
    const view = await workspace(role);

    // ListMenu's root sits in a wrapper that shows it at one width only.
    expect(inside(barButton(view), 'HEADER')).not.toBeNull();
    expect(classes(barButton(view).parentElement?.parentElement ?? null)).toEqual(expect.arrayContaining(['hidden', 'sm:block']));
    expect(drawer(view)).not.toBeNull();
    expect(classes(panelButton(view).parentElement?.parentElement ?? null)).toContain('sm:hidden');
  });

  it('takes a landlord straight to the listing form and names the account a service needs', async () => {
    const view = await workspace('Owner');
    await click(barButton(view));
    expect(option(view, 'List your property').getAttribute('href')).toBe('/owner/properties/create');

    await click(option(view, 'List your service'));
    expect(textOf(notice(view))).toContain('Service provider account needed');
  });

  it('takes a provider straight to the new-service form', async () => {
    const view = await workspace('Provider');
    await click(barButton(view));
    expect(option(view, 'List your service').getAttribute('href')).toBe('/dashboard/services?new=1');
    expect(option(view, 'List your property').tagName).toBe('BUTTON');
  });

  it('tells a tenant which account each option needs', async () => {
    const view = await workspace('Client');
    await click(barButton(view));
    expect(option(view, 'List your service').tagName).toBe('BUTTON');
    await click(option(view, 'List your property'));
    expect(textOf(notice(view))).toContain("You're signed in with a tenant account. To list a property, use a landlord account.");
  });

  it('closes the navigation drawer when a listing form link in it is followed', async () => {
    const view = await workspace('Owner');
    await click(getByName(view, 'button', 'Open navigation'));
    expect(classes(drawer(view))).toContain('translate-x-0');

    await click(panelButton(view));
    await click(option(view, 'List your property'));

    expect(navigation.page.stack().at(-1)).toBe('>/owner/properties/create');
    expect(classes(drawer(view))).toContain('-translate-x-full');
  });

  it('closes the navigation drawer when the account message sends a tenant to the workspace', async () => {
    const view = await workspace('Client');
    await click(getByName(view, 'button', 'Open navigation'));
    await click(panelButton(view));
    await click(option(view, 'List your property'));
    await click(getByName(notice(view), 'a', 'Go to your workspace'));

    expect(navigation.page.stack().at(-1)).toBe('>/tenant/dashboard');
    expect(classes(drawer(view))).toContain('-translate-x-full');
  });

  it('closes only the List menu on Escape inside the provider drawer, then the drawer', async () => {
    phone(true);
    const view = await workspace('Provider');
    await click(getByName(view, 'button', 'Open navigation'));
    expect(drawer(view).getAttribute('role')).toBe('dialog');

    await click(panelButton(view));
    const first = option(view, 'List your service');
    expect(document.activeElement).toBe(first);
    await press(first, 'Escape');
    expect(option(view, 'List your service')).toBeUndefined();
    expect(drawer(view).getAttribute('role')).toBe('dialog');

    await press(panelButton(view), 'Escape');
    expect(drawer(view).hasAttribute('role')).toBe(false);
  });

  it('opens the new-service form through the History API when the provider is on the services page', async () => {
    // After a full load, next 16.2's router would send a link to this page back to the loaded URL.
    leavePage();
    navigation.page = createFakeHistory('/dashboard/services?booking=b1');
    leavePage = navigation.page.install(window);
    const view = await workspace('Provider');
    await click(barButton(view));
    await click(option(view, 'List your service'));

    expect(navigation.page.stack()).toEqual(['/dashboard/services?booking=b1', '>/dashboard/services?new=1']);
    expect(navigation.page.history.pushState).toHaveBeenCalledTimes(1);
  });

  it('closes the provider drawer when the new-service link in it is followed', async () => {
    phone(true);
    const view = await workspace('Provider');
    await click(getByName(view, 'button', 'Open navigation'));
    await click(panelButton(view));
    await click(option(view, 'List your service'));

    expect(navigation.page.stack().at(-1)).toBe('>/dashboard/services?new=1');
    expect(drawer(view).hasAttribute('role')).toBe(false);
  });
});
