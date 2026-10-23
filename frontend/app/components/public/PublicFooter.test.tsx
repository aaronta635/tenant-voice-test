import { readFileSync } from 'node:fs';
import { cleanup, render } from '@/app/components/ui/test-dom';
import { contrast, hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeNextPath } from '@/app/lib/auth-redirect';
import { isPageRoute } from '@/app/test-utils/app-routes';
import { componentNamed, findAll } from '@/app/test-utils/shallow-render';
import { renderMarkup } from '@/app/test-utils/static-markup';
import PublicFooter from './PublicFooter';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

afterEach(cleanup);

const footer = () => renderMarkup(<PublicFooter />);
const url = (href: string) => new URL(href, 'https://tenantvoice.test');

describe('PublicFooter links', () => {
  it('opens a page the app has from every link', () => {
    const { links } = footer();
    expect(links.length).toBeGreaterThan(10);
    expect(links.filter((link) => !isPageRoute(url(link.href).pathname))).toEqual([]);
  });

  it('only returns sign-ups and sign-ins to pages the app has, for account types it has', () => {
    const { links } = footer();
    for (const { href } of links) {
      const { searchParams } = url(href);
      const next = searchParams.get('next');
      if (next !== null) {
        expect(safeNextPath(next)).toBe(next);
        expect(isPageRoute(url(next).pathname)).toBe(true);
      }
      const role = searchParams.get('role');
      if (role !== null) expect(['tenant', 'landlord', 'service_provider']).toContain(role);
    }
  });

  it('lists the reference columns, each with links to existing pages', () => {
    const { headings } = footer();
    expect(headings).toEqual(['h2 For tenants', 'h2 For landlords', 'h2 For service providers', 'h2 Company', 'h2 Legal', 'h2 Support']);
  });

  it('lists a property and a service through sign-up for that account type, landing on its form', () => {
    const { links } = footer();
    expect(links).toEqual(expect.arrayContaining([
      { href: `/register?role=landlord&next=${encodeURIComponent('/owner/properties/create')}`, text: 'List your property' },
      { href: `/register?role=service_provider&next=${encodeURIComponent('/dashboard/services?new=1')}`, text: 'List your service' },
    ]));
  });

  it('finds tenants on the tenant tab of the profile search, in-page when /search is open', () => {
    const { links } = footer();
    const [findTenants] = links.filter((link) => link.text === 'Find tenants');
    expect(url(findTenants.href).pathname).toBe('/search');
    expect(Object.fromEntries(url(findTenants.href).searchParams)).toEqual({ type: 'profiles', role: 'tenant' });
    const inPage = findAll(PublicFooter(), componentNamed('WithinPageLink'));
    expect(inPage.map((link) => link.props.href)).toEqual([findTenants.href]);
  });

  it('dates the copyright with the current year', () => {
    expect(footer().text).toContain(`© ${new Date().getFullYear()} TenantVoice. All rights reserved.`);
  });
});

describe('app routes used by the footer test', () => {
  it('knows the static, grouped and dynamic pages, and nothing else', () => {
    expect(isPageRoute('/')).toBe(true);
    expect(isPageRoute('/faqs')).toBe(true);
    expect(isPageRoute('/categories/tradies')).toBe(true);
    expect(isPageRoute('/owner/properties/create')).toBe(true);
    expect(isPageRoute('/create-profile')).toBe(false);
    expect(isPageRoute('/categories/tradies/extra')).toBe(false);
  });
});

describe('PublicFooter focus ring', () => {
  const css = readFileSync(new URL('../../globals.css', import.meta.url), 'utf8');
  const NAVY = '#0e2a48';

  it('draws keyboard focus in a colour that shows on the navy footer', async () => {
    const footer = (await render(<PublicFooter />)).children[0];
    expect(footer.tagName).toBe('FOOTER');
    expect(footer.getAttribute('data-surface')).toBe('dark');

    // The default ring is too faint on navy for WCAG 1.4.11.
    const base = /:where\(a, button[^)]*\):focus-visible \{\s*outline: 2px solid var\(--color-primary-strong\)/.exec(css);
    expect(base).not.toBeNull();
    expect(contrast('#4f46b8', NAVY)).toBeLessThan(3);
    // The dark-surface rule comes later at the same specificity, outside any layer, so it wins.
    const dark = /:where\(\[data-surface="dark"\]\) :where\(a, button[^)]*\):focus-visible \{\s*outline-color: (#[0-9a-f]{6});/i.exec(css);
    expect(dark).not.toBeNull();
    expect(dark!.index).toBeGreaterThan(base!.index);
    expect(css.slice(0, dark!.index)).not.toContain('@layer');
    expect(contrast(dark![1], NAVY)).toBeGreaterThanOrEqual(3);
  });
});

describe('PublicFooter contrast', () => {
  it('keeps its headings, links and copyright at AA contrast, also under the pointer', async () => {
    const view = await render(<PublicFooter />);
    expect(view.textContent).toContain('For landlords');
    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
