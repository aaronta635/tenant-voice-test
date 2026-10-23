'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { clearAuthSession, getAuthToken, setAuthToken } from '@/app/lib/api';
import { isUnexpiredJwt, parseRole, ROLE_COOKIE, sessionCookie, setSessionRole } from '@/app/lib/session-role';

/** Migrate valid old sessions; distinguish intentional logout from recoverable expiry. */
export default function SessionRoleSync() {
  return <Suspense><SessionSync /></Suspense>;
}
function SessionSync() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const didSync = useRef(false);
  const handledLogout = useRef<string | null>(null);
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);
  const noticeKey = params.get('requested');
  const requestedRole = parseRole(params.get('workspace'));
  const workspace = requestedRole ? { Provider: 'service provider', Owner: 'landlord', Client: 'tenant' }[requestedRole] : null;

  useEffect(() => {
    if (didSync.current) return;
    didSync.current = true;
    const cookies = document.cookie.split(';').map((item) => item.trim());
    const tokenCookie = cookies.some((item) => item.startsWith('tv_token='));
    const roleCookie = cookies.some((item) => item.startsWith(`${ROLE_COOKIE}=`));
    const storedRole = parseRole(localStorage.getItem('tv_role'));
    const storedToken = localStorage.getItem('tv_token');
    if (!tokenCookie) {
      // Invalid or expired mirrors must not revive a stale role cookie.
      const validLegacyToken = isUnexpiredJwt(storedToken);
      if (validLegacyToken && storedRole && storedToken) {
        setAuthToken(storedToken); setSessionRole(storedRole); router.refresh();
      } else {
        // Middleware already treats a missing cookie as signed out; drop an
        // expired mirror so no screen offers a session that cannot load.
        if (storedToken && !validLegacyToken) clearAuthSession();
        if (roleCookie) {
          document.cookie = sessionCookie(ROLE_COOKIE, '', 0);
          router.refresh();
        }
      }
    } else if (!roleCookie && storedRole) {
      setSessionRole(storedRole); router.refresh();
    }
  }, [router]);

  useEffect(() => {
    const protectedPage = ['/dashboard','/owner','/tenant'].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    const guardExplicitLogout = () => {
      // A 401 intentionally keeps drafts in memory for reauthentication. Only a
      // logout marker plus absent credentials may discard a cached private page.
      const logout = localStorage.getItem('tv_explicit_logout');
      if (getAuthToken() || !logout) return;
      if (protectedPage) {
        document.body.style.visibility = 'hidden';
        const role = pathname.startsWith('/owner') ? 'landlord' : pathname.startsWith('/tenant') ? 'tenant' : 'service_provider';
        window.location.replace(`/login?role=${role}`);
      } else if (!pathname.startsWith('/login') && !pathname.startsWith('/register')) {
        document.body.style.visibility = '';
        // Re-render once per sign-out, and only a page loaded before it; one
        // requested since then already rendered signed out.
        if (handledLogout.current === logout) return;
        handledLogout.current = logout;
        if (Number(logout) > performance.timeOrigin) router.refresh();
      }
    };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) guardExplicitLogout(); };
    const onStorage = (event: StorageEvent) => { if (event.key === 'tv_explicit_logout' && event.newValue) guardExplicitLogout(); };
    guardExplicitLogout();
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('pageshow',onPageShow); window.removeEventListener('storage',onStorage); };
  }, [pathname,router]);

  if (params.get('notice') !== 'wrong-workspace' || !workspace || dismissedNotice === noticeKey) return null;
  return <div role="status" className="flex items-center justify-between gap-3 border-b border-warning bg-white px-4 py-3 text-sm text-warning print:hidden"><p>That page belongs to the {workspace} workspace. You have been returned to your own workspace.</p><button type="button" aria-label="Dismiss workspace notice" className="min-h-11 shrink-0 rounded-lg border border-control-border px-3 font-semibold" onClick={() => setDismissedNotice(noticeKey)}>Dismiss</button></div>;
}
