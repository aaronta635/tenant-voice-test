import Link from 'next/link';
import type { ReactNode } from 'react';
import { navigateWithinPage } from '@/app/lib/page-url';

/**
 * A link to another view of the open admin page (a tab, a status, a range),
 * chip-shaped as FilterChip. It opens through the History API (lib/page-url)
 * and marks the current view, which also shows a check mark, so the choice
 * never rests on colour alone.
 */
export default function AdminViewLink({ href, selected, children }: { href: string; selected: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      onNavigate={navigateWithinPage(href)}
      aria-current={selected ? 'page' : undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm transition-colors ${
        selected
          ? 'border-primary-strong bg-primary-strong font-bold text-white'
          : 'border-control-border bg-white font-medium text-text-body hover:bg-surface hover:text-text-dark'
      }`}
    >
      {selected ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="-ml-1 size-4 shrink-0" aria-hidden>
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      ) : null}
      {children}
    </Link>
  );
}
