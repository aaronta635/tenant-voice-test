'use client';

import { useEffect, useEffectEvent, useId, useRef, type ReactNode, type SyntheticEvent } from 'react';
import Button from './Button';

export default function Modal({ open, title, onClose, children, busy = false, className = '', returnFocus }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
  busy?: boolean; className?: string;
  /** Where focus goes on close if the control that opened the dialog is gone or disabled by then. */
  returnFocus?: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Focus and scroll when Escape reached the dialog, put back if the browser
  // then closes it and keepOpen shows it again.
  const beforeEscape = useRef<{ focus: Element | null; top: number } | null>(null);
  const titleId = useId();
  const focusFallback = useEffectEvent(() => returnFocus?.()?.focus());
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      // Take focus back from the dialog, or from the page body where it
      // lands when the focused control goes away, but not from another
      // element the person has moved to.
      const active = document.activeElement;
      const returning = !active || active === document.body || !active.isConnected || dialog.contains(active);
      dialog.close();
      document.body.style.overflow = overflow;
      if (!returning) return;
      if (opener?.isConnected) opener.focus();
      // The action the dialog confirmed may have removed the opener, which
      // would leave focus on the page body.
      if (!opener || document.activeElement !== opener) focusFallback();
    };
  }, [open]);
  // Chrome lets a second Escape with no click in between close the dialog,
  // as that cancel event cannot be cancelled. Show it again while the page
  // still has it open, so a busy dialog stays up until its save ends.
  function keepOpen(event: SyntheticEvent<HTMLDialogElement>) {
    const dialog = event.currentTarget;
    if (!open || dialog.open || !dialog.isConnected) return;
    dialog.showModal();
    // showModal() moves focus to the first control and scrolls to the top,
    // which loses the person's place or lands on an enabled action.
    const kept = beforeEscape.current;
    if (kept?.focus instanceof HTMLElement && kept.focus.isConnected && dialog.contains(kept.focus)) kept.focus.focus({ preventScroll: true });
    else dialog.focus({ preventScroll: true });
    if (kept) dialog.scrollTop = kept.top;
  }
  return <dialog ref={ref} tabIndex={-1} aria-labelledby={titleId} aria-modal="true"
    className={`m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-2xl border border-border bg-white p-6 text-text-dark shadow-lg backdrop:bg-navy/60 ${className}`}
    onCancel={(event) => {
      beforeEscape.current = { focus: document.activeElement, top: event.currentTarget.scrollTop };
      event.preventDefault();
      if (!busy) onClose();
    }}
    onClose={keepOpen}
    onClick={(event) => {
      if (event.target !== event.currentTarget || busy) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <div className="mb-5 flex items-start justify-between gap-4">
      <h2 id={titleId} className="font-heading text-h3 font-semibold">{title}</h2>
      <Button type="button" variant="ghost" aria-label={`Close ${title}`} disabled={busy} onClick={onClose}>Close</Button>
    </div>
    {open ? children : null}
  </dialog>;
}
