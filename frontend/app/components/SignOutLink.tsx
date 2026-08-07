'use client';

import Link from 'next/link';
import { clearAuthSession } from '@/app/lib/api';

type SignOutLinkProps = {
  className?: string;
  onClick?: () => void;
  children?: React.ReactNode;
};

export default function SignOutLink({
  className,
  onClick,
  children = 'Sign out',
}: SignOutLinkProps) {
  return (
    <Link
      href="/login"
      className={className}
      role="menuitem"
      onClick={() => {
        clearAuthSession();
        onClick?.();
      }}
    >
      {children}
    </Link>
  );
}
