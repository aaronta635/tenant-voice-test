import { cleanup, click, descendants, fire, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MobileNav from '@/app/components/layout/MobileNav';
import { createFakeHistory, type FakeHistory } from '@/app/test-utils/fake-history';
import ListMenu from './ListMenu';

/** The page's URL; links and navigate() change it under the mounted menu, as Next does. */
const navigation = vi.hoisted(() => ({ page: null as unknown as FakeHistory }));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePathname: () => useSyncExternalStore((listener) => navigation.page.subscribe(listener), () => navigation.page.location.pathname),
  };
});
vi.mock('next/link', async () => ({
  default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => navigation.page.navigate(href)),
}));

const SERVICE_SIGN_UP = `/register?role=service_provider&next=${encodeURIComponent('/dashboard/services?new=1')}`;
const PROPERTY_SIGN_UP = `/register?role=landlord&next=${encodeURIComponent('/owner/properties/create')}`;

let leavePage = () => {};
beforeEach(() => {
  navigation.page = createFakeHistory('/');
  leavePage = navigation.page.install(window);
  signIn(null);
});
afterEach(async () => {
  await cleanup();
  leavePage();
});

/** A live session cookie for this account type, or none. */
function signIn(role: 'Client' | 'Provider' | 'Owner' | null) {
  document.cookie = role ? `tv_token=live-access; tv_role=${role}` : '';
}

const focused = () => document.activeElement as unknown as FakeElement;
const press = (target: FakeElement, key: string) => act(async () => { fire(target, 'keydown', { key }); });
/** Tab as a browser presses it: the key, then focus moving on before any timer can run. */
const tab = (from: FakeElement, to: FakeElement) => act(async () => { fire(from, 'keydown', { key: 'Tab' }); to.focus(); });
const button = (root: FakeElement, name = 'List your service or property') => getByName(root, 'button', name);
const menu = (root: FakeElement) => descendants(root).find((element) => element.getAttribute('role') === 'menu');
const options = (root: FakeElement) => descendants(menu(root) as FakeElement).filter((element) => element.getAttribute('role') === 'menuitem');
const option = (root: FakeElement, label: string) => options(root).find((element) => textOf(element).startsWith(label)) as FakeElement;
const notice = (root: FakeElement) => descendants(root).find((element) => element.getAttribute('role') === 'dialog');

async function openMenu() {
  const view = await render(<ListMenu />);
  await click(button(view));
  return view;
}

describe('the List menu button', () => {
  it('is a collapsed menu button until opened, named for screen readers beyond its visible "List"', async () => {
    const view = await render(<ListMenu />);
    const trigger = button(view);
    const visible = descendants(trigger).filter((element) => !element.className.includes('sr-only') && element.tagName === 'SPAN');
    expect(visible[0].childNodes[0].textContent).toBe('List');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
    expect(menu(view)).toBeUndefined();
  });

  it('opens on a click with focus on the first option, as a menu named by its button', async () => {
    const view = await openMenu();
    const trigger = button(view);
    const list = menu(view) as FakeElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(list.id);
    expect(list.getAttribute('aria-labelledby')).toBe(trigger.id);
    expect(options(view).map((item) => textOf(item))).toEqual([
      'List your service For service providers: offer upfront-priced work',
      'List your property For landlords: advertise a rental and review applicants',
    ]);
    expect(focused()).toBe(options(view)[0]);
  });

  it('moves between the options with the arrow keys, Home and End, wrapping at the ends', async () => {
    const view = await openMenu();
    const [service, property] = options(view);
    await press(service, 'ArrowDown');
    expect(focused()).toBe(property);
    await press(property, 'ArrowDown');
    expect(focused()).toBe(service);
    await press(service, 'ArrowUp');
    expect(focused()).toBe(property);
    await press(property, 'Home');
    expect(focused()).toBe(service);
    await press(service, 'End');
    expect(focused()).toBe(property);
  });

  it('opens from the keyboard on the first option with ArrowDown and the last with ArrowUp', async () => {
    const view = await render(<ListMenu />);
    await press(button(view), 'ArrowDown');
    expect(focused()).toBe(options(view)[0]);
    await press(focused(), 'Escape');
    await press(button(view), 'ArrowUp');
    expect(focused()).toBe(options(view)[1]);
  });

  it('closes on Escape and gives focus back to the button', async () => {
    const view = await openMenu();
    await press(options(view)[1], 'Escape');
    expect(menu(view)).toBeUndefined();
    expect(button(view).getAttribute('aria-expanded')).toBe('false');
    expect(focused()).toBe(button(view));
  });

  it('closes once Tab has taken focus out of it, and stays open while Tab moves between its options', async () => {
    const view = await render(<><ListMenu /><a href="/faqs">Next link</a></>);
    await click(button(view));
    const [service, property] = options(view);
    await tab(service, property);
    await settle();
    expect(menu(view)).toBeDefined();

    const next = getByName(view, 'a', 'Next link');
    await tab(property, next);
    await settle();
    expect(menu(view)).toBeUndefined();
    expect(focused()).toBe(next);
  });

  it('closes on a press outside it and leaves focus there, but not on a press inside', async () => {
    const view = await render(<><ListMenu /><button type="button">Elsewhere</button></>);
    await click(button(view));
    await act(async () => { fire(options(view)[0], 'pointerdown'); });
    expect(menu(view)).toBeDefined();

    const elsewhere = getByName(view, 'button', 'Elsewhere');
    elsewhere.focus();
    await act(async () => { fire(elsewhere, 'pointerdown'); });
    expect(menu(view)).toBeUndefined();
    expect(focused()).toBe(elsewhere);
  });

  it('closes when an option is followed and on any other navigation', async () => {
    const view = await openMenu();
    await click(options(view)[0]);
    expect(navigation.page.stack()).toEqual(['/', `>${SERVICE_SIGN_UP}`]);
    expect(menu(view)).toBeUndefined();

    await click(button(view));
    await act(async () => { navigation.page.navigate('/properties'); });
    expect(menu(view)).toBeUndefined();
  });
});

describe('the List menu for each session', () => {
  it('sends a visitor to sign up for the account type each option needs, returning to its form', async () => {
    const view = await openMenu();
    expect(options(view).map((item) => item.getAttribute('href'))).toEqual([SERVICE_SIGN_UP, PROPERTY_SIGN_UP]);
  });

  it('takes a provider straight to the new-service form and a landlord straight to the listing form', async () => {
    signIn('Provider');
    let view = await openMenu();
    expect(option(view, 'List your service').getAttribute('href')).toBe('/dashboard/services?new=1');
    await cleanup();

    signIn('Owner');
    view = await openMenu();
    expect(option(view, 'List your property').getAttribute('href')).toBe('/owner/properties/create');
  });

  it('reads the session as it opens, so a sign-in since the page loaded counts', async () => {
    const view = await render(<ListMenu />);
    signIn('Owner');
    await click(button(view));
    expect(option(view, 'List your property').getAttribute('href')).toBe('/owner/properties/create');
  });

  it.each([
    ['Client', 'List your property', 'Landlord account needed', "You're signed in with a tenant account. To list a property, use a landlord account.", '/tenant/dashboard', `/login?role=landlord&next=${encodeURIComponent('/owner/properties/create')}`],
    ['Client', 'List your service', 'Service provider account needed', "You're signed in with a tenant account. To list a service, use a service provider account.", '/tenant/dashboard', `/login?role=service_provider&next=${encodeURIComponent('/dashboard/services?new=1')}`],
    ['Provider', 'List your property', 'Landlord account needed', "You're signed in with a service provider account. To list a property, use a landlord account.", '/dashboard', `/login?role=landlord&next=${encodeURIComponent('/owner/properties/create')}`],
    ['Owner', 'List your service', 'Service provider account needed', "You're signed in with a landlord account. To list a service, use a service provider account.", '/owner', `/login?role=service_provider&next=${encodeURIComponent('/dashboard/services?new=1')}`],
  ] as const)('tells a %s choosing "%s" which account it needs instead of sending it on', async (role, label, title, message, workspace, signInHref) => {
    signIn(role);
    const view = await openMenu();
    expect(option(view, label).tagName).toBe('BUTTON');
    await click(option(view, label));

    const dialog = notice(view) as FakeElement;
    expect(menu(view)).toBeUndefined();
    expect(navigation.page.stack()).toEqual(['>/']);
    expect(textOf(descendants(dialog).find((element) => element.id === dialog.getAttribute('aria-labelledby')) as FakeElement)).toBe(title);
    expect(textOf(descendants(dialog).find((element) => element.id === dialog.getAttribute('aria-describedby')) as FakeElement)).toBe(message);
    expect(focused()).toBe(dialog);
    expect(getByName(dialog, 'a', /^Sign out and continue as a/).getAttribute('href')).toBe(signInHref);
    expect(getByName(dialog, 'a', 'Go to your workspace').getAttribute('href')).toBe(workspace);
  });

  it('closes the message on Escape or its close button and gives focus back to the List button', async () => {
    signIn('Client');
    const view = await openMenu();
    await click(option(view, 'List your property'));
    await press(notice(view) as FakeElement, 'Escape');
    expect(notice(view)).toBeUndefined();
    expect(focused()).toBe(button(view));

    await click(button(view));
    await click(option(view, 'List your property'));
    await click(getByName(notice(view) as FakeElement, 'button', 'Close message'));
    expect(notice(view)).toBeUndefined();
    expect(focused()).toBe(button(view));
  });
});

describe('the List menu inside the mobile menu', () => {
  const body = () => document.body as unknown as FakeElement;
  const panel = () => descendants(body()).find((element) => element.getAttribute('aria-label') === 'Navigation menu');

  async function openPanel() {
    const view = await render(
      <MobileNav items={[{ href: '/properties', label: 'Rentals' }]}>
        <ListMenu placement="panel" />
      </MobileNav>,
    );
    await click(getByName(view, 'button', 'Open menu'));
    await click(button(panel() as FakeElement, 'List on TenantVoice'));
    return panel() as FakeElement;
  }

  it('closes the List menu first on Escape, and the mobile menu on the next', async () => {
    const menuPanel = await openPanel();
    expect(focused()).toBe(options(menuPanel)[0]);
    await press(options(menuPanel)[0], 'Escape');
    expect(menu(menuPanel)).toBeUndefined();
    expect(panel()).toBe(menuPanel);
    expect(focused()).toBe(button(menuPanel, 'List on TenantVoice'));

    await press(focused(), 'Escape');
    expect(panel()).toBeUndefined();
  });

  it('closes the mobile menu when an option is followed', async () => {
    const menuPanel = await openPanel();
    await click(option(menuPanel, 'List your property'));
    expect(navigation.page.stack().at(-1)).toBe(`>${PROPERTY_SIGN_UP}`);
    expect(panel()).toBeUndefined();
  });
});

describe('the List menu contrast', () => {
  it('keeps the button and its options at AA contrast, also under the pointer', async () => {
    const view = await openMenu();
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });

  it('keeps the account message at AA contrast, also under the pointer', async () => {
    signIn('Client');
    const view = await openMenu();
    await click(option(view, 'List your property'));
    expect(textOf(view)).toContain('Landlord account needed');
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
