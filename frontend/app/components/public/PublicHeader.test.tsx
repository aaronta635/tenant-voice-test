import { cleanup, click, getByName, render } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_MARKETPLACE_HREF, searchHref } from '@/app/lib/home-search';
import { componentNamed, find, findAll, textOf } from '@/app/test-utils/shallow-render';
import PublicHeader from './PublicHeader';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

afterEach(cleanup);

describe('PublicHeader on a 320px phone', () => {
  // Measured in Chrome: menu button, logo, "Sign in" and "List service" need
  // 312px of the 288px between the gutters, so the row ran 8px off screen.
  it('drops "Sign in" from the bar below 360px and offers it in the menu', () => {
    const header = PublicHeader();
    const signIn = find(header, (element) => element.props.href === '/login' && textOf(element).trim() === 'Sign in');
    expect(String(signIn.props.className).split(' ')).toContain('max-[360px]:hidden');
    expect(find(header, componentNamed('MobileNav')).props.items).toContainEqual({ href: '/login', label: 'Sign in' });
  });
});

describe('PublicHeader listing', () => {
  it('offers the List menu in the bar and in the mobile menu instead of a provider sign-up button', () => {
    const header = PublicHeader();
    const menus = findAll(header, componentNamed('ListMenu'));
    expect(menus.map((menu) => menu.props.placement ?? 'bar').sort()).toEqual(['bar', 'panel']);
    expect(find(find(header, componentNamed('MobileNav')).props.children, componentNamed('ListMenu')).props.placement).toBe('panel');
    expect(findAll(header, (element) => String(element.props.href ?? '').startsWith('/register'))).toEqual([]);
    const menuItems = find(header, componentNamed('MobileNav')).props.items as { href: string }[];
    expect(menuItems.map((item) => item.href)).not.toContain('/register?role=service_provider');
  });

  it('opens the provider marketplace from "Find providers", as the homepage button does', () => {
    const header = PublicHeader();
    expect(find(header, (element) => textOf(element).trim() === 'Find providers').props.href).toBe(PROVIDER_MARKETPLACE_HREF);
  });

  it('opens every profile on /search from "Find profiles", in the bar and the mobile menu', () => {
    const header = PublicHeader();
    const href = searchHref('profiles', '');
    expect(href).toBe('/search?type=profiles&role=all');
    expect(find(header, (element) => textOf(element).trim() === 'Find profiles').props.href).toBe(href);
    expect(find(header, componentNamed('MobileNav')).props.items).toContainEqual({ href, label: 'Find profiles', withinPage: true });
  });

  it('opens "Find profiles" through the History API when /search is already open, as its own links do', () => {
    const header = PublicHeader();
    // /search reads its query on the client; the other pages read theirs on the server.
    expect(find(header, componentNamed('WithinPageLink')).props.href).toBe(searchHref('profiles', ''));
    expect(findAll(header, componentNamed('WithinPageLink'))).toHaveLength(1);
    const menuItems = find(header, componentNamed('MobileNav')).props.items as { label: string; withinPage?: boolean }[];
    expect(menuItems.filter((item) => item.withinPage).map((item) => item.label)).toEqual(['Find profiles']);
  });
});

describe('PublicHeader contrast', () => {
  it('keeps "Sign in", the List button and its options at AA contrast, also under the pointer', async () => {
    const view = await render(<PublicHeader />);
    await click(getByName(view, 'button', 'List your service or property'));
    expect(view.textContent).toContain('Sign in');
    expect(view.textContent).toContain('List your service');
    expect(view.textContent).toContain('List your property');
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
