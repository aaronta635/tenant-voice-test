import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard', '/owner', '/tenant'];

// Which signed-in role each workspace belongs to, and where each role lives.
// Mirrors ROLE_HOME in app/lib/session-role.ts (middleware can't import it
// without pulling client code into the edge bundle).
const PREFIX_ROLE: Record<string, string> = { '/dashboard': 'Provider', '/owner': 'Owner', '/tenant': 'Client' };
const ROLE_HOME: Record<string, string> = {
  Provider: '/dashboard',
  Owner: '/owner',
  Client: '/tenant/dashboard',
};

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === '/tenant/signup') {
    const url = request.nextUrl.clone();
    url.pathname = '/register';
    url.search = 'role=tenant';
    return NextResponse.redirect(url);
  }
  if (pathname === '/tenant/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = 'role=tenant';
    return NextResponse.redirect(url);
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return NextResponse.next();

  const token = request.cookies.get('tv_token')?.value;
  if (token) {
    // A landlord or tenant opening the provider workspace (or vice versa) is
    // sent to their own home instead of a half-working screen. The API still
    // enforces roles; this only keeps people in the right place.
    const role = request.cookies.get('tv_role')?.value;
    const prefix = PROTECTED_PREFIXES.find((p) => pathname === p || pathname.startsWith(`${p}/`));
    const home = role ? ROLE_HOME[role] : undefined;
    if (prefix && home && PREFIX_ROLE[prefix] !== role) {
      const url = request.nextUrl.clone();
      url.pathname = home;
      url.search = '';
      url.searchParams.set('notice', 'wrong-workspace');
      url.searchParams.set('workspace', PREFIX_ROLE[prefix]);
      url.searchParams.set('requested', `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  const next = `${pathname}${search}`;
  if (next.startsWith('/')) login.searchParams.set('next', next);
  login.searchParams.set('role', pathname.startsWith('/owner') ? 'landlord' : pathname.startsWith('/tenant') ? 'tenant' : 'service_provider');
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/dashboard/:path*', '/dashboard', '/owner/:path*', '/owner', '/tenant/:path*', '/tenant'],
};
