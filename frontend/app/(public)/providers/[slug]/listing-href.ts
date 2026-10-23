import { safeNextPath } from '@/app/lib/auth-redirect';

/**
 * The provider listing a profile was opened from (its ?from=), so "← Providers"
 * returns to the visitor's filters. The value comes from the URL, so only a
 * local /categories path is used; anything else would let a crafted link send
 * that button to another site.
 */
export function listingHref(from: string | string[] | undefined): string | null {
  const path = safeNextPath(typeof from === 'string' ? from : null);
  const pathname = path?.split(/[?#]/)[0];
  return path && (pathname === '/categories' || pathname?.startsWith('/categories/')) ? path : null;
}
