'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  parseRole,
  ROLE_COOKIE,
  setSessionRole,
} from '@/app/lib/session-role';

/**
 * Migrates older localStorage-only sessions onto the tv_role cookie so
 * public marketplace routes can render inside the correct role shell.
 */
export default function SessionRoleSync() {
  const router = useRouter();
  const didSync = useRef(false);

  useEffect(() => {
    if (didSync.current) return;
    didSync.current = true;

    const stored = parseRole(localStorage.getItem('tv_role'));
    if (!stored) return;

    const hasCookie = document.cookie
      .split(';')
      .some((part) => part.trim().startsWith(`${ROLE_COOKIE}=`));

    if (!hasCookie) {
      setSessionRole(stored);
      router.refresh();
    }
  }, [router]);

  return null;
}
