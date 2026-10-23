'use client';

import Link from 'next/link';
import { roleForSignIn } from '@/app/lib/auth-redirect';
import { getClientSessionRole, parseRole } from '@/app/lib/session-role';
import { clearAuthSession, getSessionRecovery, toBackendRole } from '@/app/lib/api';

type SignOutLinkProps = {
  className?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  /** "menuitem" when the link sits in a role="menu", which may own only menu items. */
  role?: React.AriaRole;
  /** Sign-in to open afterwards, such as another account type's; by default the signed-out account's. */
  signInHref?: string;
};

/**
 * The signed-out page stays hidden until sign-in arrives; show why instead of a
 * blank window, with a way on if that navigation is slow or cancelled. Built
 * outside React because closing a menu may unmount this link.
 */
function showSigningOut(loginHref: string) {
  const cover = document.createElement('div');
  cover.className = 'visible fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.className = 'text-base font-semibold text-text-dark';
  status.textContent = 'Signing out…';
  const link = document.createElement('a');
  link.href = loginHref;
  link.className = 'inline-flex min-h-11 items-center px-3 text-sm font-semibold text-primary-strong underline';
  link.textContent = 'Continue to sign in';
  cover.append(status, link);
  document.body.append(cover);
  link.focus();
}

export default function SignOutLink({
  className,
  onClick,
  children = 'Sign out',
  role,
  signInHref,
}: SignOutLinkProps) {
  return (
    <Link
      href={signInHref ?? '/login'}
      className={className}
      role={role}
      onClick={(event) => {
        event.preventDefault();
        // An expired session has already cleared the stored role: use the one
        // it recorded, else the workspace this link was opened from.
        const role = getClientSessionRole() ?? parseRole(getSessionRecovery()?.role) ?? roleForSignIn(null, window.location.pathname);
        const loginHref = signInHref ?? (role ? `/login?role=${toBackendRole(role)}` : '/login');
        clearAuthSession();
        localStorage.setItem('tv_explicit_logout', String(Date.now()));
        document.body.style.visibility = 'hidden';
        showSigningOut(loginHref);
        onClick?.();
        window.location.replace(loginHref);
      }}
    >
      {children}
    </Link>
  );
}
