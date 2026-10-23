/**
 * Every page the support chat's help passages link to (backend
 * app/data/help/*.md, "Page:") is a page of this app: an answer or a source
 * never leads to a 404. A /tenant/<section> link must name a tenant screen.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPageRoute } from '@/app/test-utils/app-routes';
import { getTenantScreen } from '@/app/lib/tenant-data';
import { safeInternalHref } from '@/app/lib/support-chat';

const HELP_DIR = new URL('../../../../backend/app/data/help/', import.meta.url);
const files = readdirSync(HELP_DIR).filter((name) => name.endsWith('.md'));
const pages = files.flatMap((name) => [...readFileSync(new URL(name, HELP_DIR), 'utf8').matchAll(/^Page:\s*(\S+)\s*$/gm)]
  .map((match) => ({ file: name, page: match[1] })));

/** Paths that only the [section] route serves: they must be one of its screens. */
const TENANT_ROUTES = /^\/tenant\/(applications|bookings|complaints|dashboard|inspections|leases|maintenance|messages|network|onboarding|pipeline|properties|recommendations|rent)(\/|$)/;

describe('the help passages', () => {
  it('are read from every help file', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(pages.length).toBeGreaterThan(40);
  });

  it.each(pages)('link $file to a page of the app: $page', ({ page }) => {
    expect(safeInternalHref(page)).toBe(page);
    const path = page.split('#')[0];
    expect(isPageRoute(path)).toBe(true);
    if (path.startsWith('/tenant/') && !TENANT_ROUTES.test(path)) {
      expect(getTenantScreen(path.slice('/tenant/'.length))).toBeDefined();
    }
  });
});
