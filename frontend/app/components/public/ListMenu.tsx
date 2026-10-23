'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SignOutLink from '@/app/components/SignOutLink';
import { toBackendRole } from '@/app/lib/api';
import { ROLE_LABELS } from '@/app/lib/format';
import { LIST_OPTIONS, listOptionHref, listOptionSignInHref, type ListOption } from '@/app/lib/list-options';
import { navigateWithinPage } from '@/app/lib/page-url';
import { getClientSessionRole, ROLE_HOME, type SessionRole } from '@/app/lib/session-role';

type Placement = 'bar' | 'panel';
/** An option this account type cannot open, and the account it was chosen from. */
type Notice = { option: ListOption; session: SessionRole };

const ITEM_CLASS = 'block w-full rounded-xl px-3 py-2.5 text-left hover:bg-surface focus-visible:bg-surface';

/**
 * The header's "List" menu button: list a service or a property. The session
 * is read as the menu opens, so a sign-in since the page loaded counts. A
 * visitor is sent to sign up for the option's account type, that account type
 * goes straight to the form, and any other is told which account it needs.
 * onFollow runs as one of its links is followed, so a drawer around it can close.
 */
export default function ListMenu({ placement = 'bar', onFollow }: { placement?: Placement; onFollow?: () => void }) {
  const pathname = usePathname();
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  // Null while closed; otherwise the session it opened with and the item to focus.
  const [open, setOpen] = useState<{ session: SessionRole | null; focus: 'first' | 'last' } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // A navigation, such as Back, closes whatever is open.
  const [shownOn, setShownOn] = useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    setOpen(null);
    setNotice(null);
  }
  const active = open !== null || notice !== null;
  const menuId = `${id}-menu`;

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('a,button') ?? []);

  useEffect(() => {
    if (!open) return;
    const list = items();
    (open.focus === 'last' ? list.at(-1) : list[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  // A press outside closes it and leaves focus where the press put it.
  useEffect(() => {
    if (!active) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(null);
      setNotice(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [active]);

  function show(focus: 'first' | 'last') {
    setNotice(null);
    setOpen({ session: getClientSessionRole(), focus });
  }

  function close(returnFocus: boolean) {
    setOpen(null);
    setNotice(null);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    show(event.key === 'ArrowUp' ? 'last' : 'first');
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const last = list.length - 1;
    const target = {
      ArrowDown: index >= last ? 0 : index + 1,
      ArrowUp: index <= 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    list[target]?.focus();
  }

  // Escape is handled here before the mobile menu around this one sees it, so
  // only this menu closes. Tab moves on as usual; the menu closes once focus
  // has left it.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      window.setTimeout(() => {
        if (!rootRef.current?.contains(document.activeElement)) close(false);
      }, 0);
    }
  }

  const popupClass = placement === 'bar'
    ? 'absolute top-full right-0 z-50 mt-2 rounded-2xl border border-border bg-white shadow-lg'
    : 'mt-1 space-y-1';

  return (
    <div ref={rootRef} className={placement === 'bar' ? 'relative' : undefined} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        id={`${id}-button`}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show('first'))}
        onKeyDown={onTriggerKeyDown}
        className={
          placement === 'bar'
            ? 'inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent bg-primary-strong px-4 text-sm font-bold text-white shadow-[0_1px_1px_rgba(99,106,232,0.25)] transition-colors hover:bg-navy sm:px-5'
            : 'flex w-full items-center justify-between rounded-[10px] px-3 py-3 text-sm font-medium text-[#565d6d] hover:bg-[#fafafe] hover:text-[#171a1f]'
        }
      >
        {placement === 'bar' ? <span>List<span className="sr-only"> your service or property</span></span> : 'List on TenantVoice'}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={`${id}-button`}
          onKeyDown={onMenuKeyDown}
          className={`${popupClass} ${placement === 'bar' ? 'w-[min(18rem,calc(100vw_-_2rem))] p-2' : ''}`}
        >
          {LIST_OPTIONS.map((option) => {
            const href = listOptionHref(option, open.session);
            const label = (
              <>
                <span className="block text-sm font-semibold text-text-dark">{option.label}</span>{' '}
                <span className="mt-0.5 block text-xs text-text-body">{option.description}</span>
              </>
            );
            return href ? (
              // The form can be the open page, such as a provider's services.
              <Link
                key={option.id}
                href={href}
                role="menuitem"
                onClick={() => { setOpen(null); onFollow?.(); }}
                onNavigate={navigateWithinPage(href)}
                className={ITEM_CLASS}
              >
                {label}
              </Link>
            ) : (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(null);
                  setNotice({ option, session: open.session as SessionRole });
                }}
                className={ITEM_CLASS}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}

      {notice ? (
        <div
          ref={noticeRef}
          role="dialog"
          aria-labelledby={`${id}-notice-title`}
          aria-describedby={`${id}-notice-text`}
          tabIndex={-1}
          className={`${popupClass} p-4 ${placement === 'bar' ? 'w-[min(21rem,calc(100vw_-_2rem))]' : 'rounded-xl border border-border bg-white'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <p id={`${id}-notice-title`} className="font-semibold text-text-dark">
              {notice.option.account.charAt(0).toUpperCase()}{notice.option.account.slice(1)} account needed
            </p>
            <button
              type="button"
              aria-label="Close message"
              onClick={() => close(true)}
              className="-m-2 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-text-body hover:bg-surface"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <p id={`${id}-notice-text`} className="mt-1 text-sm text-text-body">
            You&apos;re signed in with a {ROLE_LABELS[toBackendRole(notice.session)].toLowerCase()} account. To{' '}
            {notice.option.task}, use a {notice.option.account} account.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <SignOutLink
              signInHref={listOptionSignInHref(notice.option)}
              onClick={onFollow}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-transparent bg-primary-strong px-4 py-2 text-center text-sm font-semibold text-white hover:bg-navy"
            >
              Sign out and continue as a {notice.option.account}
            </SignOutLink>
            <Link
              href={ROLE_HOME[notice.session]}
              onClick={() => { setNotice(null); onFollow?.(); }}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-primary-strong bg-white px-4 py-2 text-center text-sm font-semibold text-primary-strong hover:bg-surface"
            >
              Go to your workspace
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
