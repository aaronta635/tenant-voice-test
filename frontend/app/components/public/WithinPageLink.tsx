'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { navigateWithinPage } from '@/app/lib/page-url';

type Props = Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> & { href: string };

/**
 * A link a server component renders that can point at the open page, such as
 * the header's "Find profiles" on /search. Clicked there it opens through the
 * History API (lib/page-url): next 16.2's router would land on the loaded URL.
 * Only for pages that read their query on the client.
 */
export default function WithinPageLink({ href, ...props }: Props) {
  return <Link href={href} onNavigate={navigateWithinPage(href)} {...props} />;
}
