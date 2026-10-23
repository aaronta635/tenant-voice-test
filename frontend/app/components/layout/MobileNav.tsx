'use client';

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navigateWithinPage } from '@/app/lib/page-url';

export type MobileNavItem = {
  href: string;
  label: string;
  badge?: number;
  /** Opened through the History API on its own page, which reads its query on the client (WithinPageLink). */
  withinPage?: boolean;
};

export default function MobileNav({
  items,
  breakpointClass = 'md:hidden',
  children,
}: {
  items: MobileNavItem[];
  /** Tailwind class that hides this control once the desktop nav is visible. */
  breakpointClass?: string;
  /** More of the menu below the links, such as a menu button of its own. */
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    const siblings = Array.from(document.body.children).filter((node) => node !== panel?.parentElement) as HTMLElement[];
    const previousInert = siblings.map((node) => node.inert);
    siblings.forEach((node) => { node.inert = true; });
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])') ?? []);
    focusable()[0]?.focus();
    function onKey(event: KeyboardEvent) {
      // A popup inside the menu that took the Escape closes alone.
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setOpen(false); }
      if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      siblings.forEach((node, index) => { node.inert = previousInert[index]; });
      trigger?.focus();
    };
  }, [open]);

  // A link below the list closes the menu as it navigates, as the list's own do.
  function closeOnLink(event: MouseEvent<HTMLDivElement>) {
    for (let node = event.target as Element | null; node && node !== event.currentTarget; node = node.parentElement) {
      if (node.tagName === 'A') { setOpen(false); return; }
    }
  }

  return (
    <div className={breakpointClass}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-10 items-center justify-center rounded-[10px] border border-[#dee1e6] text-[#171a1f] hover:bg-[#f8f9fa]"
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>

      {open ? createPortal(
        <div className="fixed inset-0 z-[100]">
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            className="absolute inset-0 bg-[#171a1f]/40"
            onClick={() => setOpen(false)}
          />
          <nav
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            id={panelId}
            className="absolute inset-x-0 top-0 max-h-[85vh] overflow-y-auto border-b border-[#dee1e6] bg-white px-6 py-5 shadow-lg"
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#171a1f]">Menu</p>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="inline-flex size-11 items-center justify-center rounded-[8px] text-[#565d6d] hover:bg-[#f8f9fa]"
              >
                <CloseIcon />
              </button>
            </div>
            <ul className="space-y-1">
              {items.map((item) => {
                const active =
                  item.href === '/'
                    ? pathname === '/'
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      onNavigate={item.withinPage ? navigateWithinPage(item.href) : undefined}
                      className={`flex items-center justify-between rounded-[10px] px-3 py-3 text-sm font-medium ${
                        active
                          ? 'bg-[#f0f1ff] text-primary-strong'
                          : 'text-[#565d6d] hover:bg-[#fafafe] hover:text-[#171a1f]'
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.badge ? (
                        <span className="rounded-full bg-primary-strong px-2 py-0.5 text-[11px] font-bold text-white">
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {children ? (
              <div onClick={closeOnLink} className="mt-3 border-t border-[#efeff2] pt-3">
                {children}
              </div>
            ) : null}
          </nav>
        </div>, document.body
      ) : null}
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
