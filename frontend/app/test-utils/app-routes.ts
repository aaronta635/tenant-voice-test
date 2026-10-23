// The pages the app serves, read from its page.tsx files, so a test can tell
// whether a link opens a page or a 404.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('../', import.meta.url));

/** One URL path segment as a pattern: route groups match nothing, dynamic segments one or more segments. */
function segmentPattern(segment: string): string | null {
  if (/^\(.+\)$/.test(segment)) return null;
  if (/^\[\[\.\.\..+\]\]$/.test(segment)) return '(?:/.+)?';
  if (/^\[\.\.\..+\]$/.test(segment)) return '/.+';
  if (/^\[.+\]$/.test(segment)) return '/[^/]+';
  return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
}

export const PAGE_ROUTES: RegExp[] = readdirSync(APP_DIR, { recursive: true, encoding: 'utf8' })
  .filter((file) => /(^|\/)page\.tsx$/.test(file))
  .map((file) => {
    const pattern = file.split('/').slice(0, -1).map(segmentPattern).filter((part) => part !== null).join('');
    return new RegExp(`^${pattern || '/'}$`);
  });

/** Whether a URL path (no query) opens one of the app's pages. */
export function isPageRoute(pathname: string): boolean {
  return PAGE_ROUTES.some((route) => route.test(pathname));
}
