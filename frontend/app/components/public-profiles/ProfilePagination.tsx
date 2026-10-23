import Link from 'next/link';
import type { ReactNode } from 'react';
import { navigateWithinPage } from '@/app/lib/page-url';

type Props = { page: number; totalPages: number; hrefFor: (page: number) => string };

const ITEM = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-semibold';

/** Every page up to seven; past that the first, the last and the pages around the current one. */
export function pageList(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const shown = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((page) => shown.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => shown.add(page));
  const pages = [...shown].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  return pages.flatMap((page, index) => (index > 0 && page - pages[index - 1] > 1 ? ['gap' as const, page] : [page]));
}

/** Prev, page numbers and Next, written to the URL through the History API (lib/page-url). */
export default function ProfilePagination({ page, totalPages, hrefFor }: Props) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Result pages" className="mt-8">
      <ul className="flex flex-wrap items-center justify-center gap-2">
        <li>
          {page > 1 ? <PageLink href={hrefFor(page - 1)} label="Previous page">‹ Prev</PageLink> : <Disabled>‹ Prev</Disabled>}
        </li>
        {pageList(page, totalPages).map((item, index) => (
          <li key={item === 'gap' ? `gap-${index}` : item}>
            {item === 'gap' ? (
              <span aria-hidden className="px-1 text-text-body">…</span>
            ) : item === page ? (
              <span aria-current="page" className={`${ITEM} border-primary-strong bg-primary-strong text-white`}><span className="sr-only">Page </span>{item}</span>
            ) : (
              <PageLink href={hrefFor(item)} label={`Page ${item}`}>{item}</PageLink>
            )}
          </li>
        ))}
        <li>
          {page < totalPages ? <PageLink href={hrefFor(page + 1)} label="Next page">Next ›</PageLink> : <Disabled>Next ›</Disabled>}
        </li>
      </ul>
    </nav>
  );
}

function PageLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Link href={href} aria-label={label} onNavigate={navigateWithinPage(href)} className={`${ITEM} border-control-border bg-white text-text-dark hover:bg-surface`}>
      {children}
    </Link>
  );
}

// Not a control: there is no page before the first or after the last.
function Disabled({ children }: { children: ReactNode }) {
  return <span aria-hidden className={`${ITEM} border-border bg-white text-text-subtle`}>{children}</span>;
}
