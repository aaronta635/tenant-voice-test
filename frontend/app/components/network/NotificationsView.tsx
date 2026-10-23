'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import PageHeader from '@/app/components/ui/PageHeader';
import Card from '@/app/components/ui/Card';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { api, ApiError, type NotificationItem } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { relativeTime } from '@/app/lib/format';
import { NOTIFICATIONS_PAGE, notificationHref, readerRoleOf, type ReaderRole } from '@/app/lib/notification-links';

export type NotificationsViewProps = {
  title?: string;
  subtitle?: string;
  /** Whose notifications these are; else read from the workspace the page is in. */
  role?: ReaderRole;
};

/** Where an action's result shows: beside its notification, or under the header for Mark all as read. */
function feedbackId(notificationId: string | null) {
  return `notification-feedback-${notificationId ?? 'page'}`;
}

export default function NotificationsView({
  title = 'Notifications',
  subtitle = 'Stay on top of applications, messages, and account alerts.',
  role,
}: NotificationsViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const reader = role ?? readerRoleOf(pathname) ?? 'tenant';
  /**
   * The web page a notification opens (lib/notification-links: the mobile
   * app's links open the reader's page), or null when it has none past this
   * page: a link nothing places falls back to the notifications page itself.
   */
  const hrefOf = (item: NotificationItem) => {
    const href = notificationHref(item.link_href, reader);
    return href && href !== NOTIFICATIONS_PAGE[reader] ? href : null;
  };
  const page = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [success, setSuccess] = useState<string | null>(null);
  // The notification the last action was on; null for Mark all as read.
  const [actionId, setActionId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    api.notifications
      .list()
      .then((list) => {
        if (active) setItems(list);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Could not load notifications.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  // The button that was pressed may be gone (a read notification loses it), so
  // focus moves to the result, which also gets it read out, unless the person
  // has moved on while it saved, say to the header search.
  useEffect(() => {
    if (actionError || success) focusResult(document.getElementById(feedbackId(actionId)), page.current);
  }, [actionError, success, actionId]);

  const unread = items.filter((item) => !item.is_read).length;

  async function markAll() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionId(null);
    setActionError(null);
    setSuccess(null);
    try {
      await api.notifications.markAllRead();
      setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setSuccess('All notifications marked as read.');
      window.dispatchEvent(new Event('tenantvoice:counts-changed'));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not mark notifications as read.');
    } finally { setBusy(false); busyRef.current = false; }
  }

  async function open(item: NotificationItem) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionId(item.id);
    setActionError(null);
    setSuccess(null);
    const href = hrefOf(item);
    if (!item.is_read) {
      try {
        await api.notifications.markRead(item.id);
        setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
        window.dispatchEvent(new Event('tenantvoice:counts-changed'));
        if (!href) setSuccess('Notification marked as read.');
      } catch {
        // A notification with a link still opens its page and simply stays
        // unread; a result shown just before leaving would never be read.
        if (!href) setActionError('Could not mark this notification as read. Please try again.');
      }
    }
    setBusy(false);
    busyRef.current = false;
    if (href) router.push(href);
  }

  return (
    <div ref={page}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <PageHeader title={title} description={subtitle} />
        {!loading && !loadError ? (
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-[#f0f1ff] px-3 py-1 text-sm font-medium text-primary-strong">
            {unread} unread
          </span>
          <Button className="h-10 rounded-[8px]" onClick={markAll} disabled={busy || unread === 0}>
            {busy && !actionId ? 'Updating…' : 'Mark all as read'}
          </Button>
        </div>) : null}
      </div>

      <div id={feedbackId(null)} tabIndex={-1} className="scroll-mt-24">
        <FormMessage error={actionId ? null : actionError} success={actionId ? null : success} />
      </div>

      {loadError ? (
        <LoadErrorCard
          message={loadError}
          onRetry={() => {
            setLoading(true);
            setLoadError(null);
            setReloadKey((k) => k + 1);
          }}
        />
      ) : (
      <Card className="overflow-hidden">
        {loading ? (
          <p className="px-6 py-8 text-center text-sm text-[#565d6d]">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-[#565d6d]">No notifications yet.</p>
        ) : (
          items.map(item => (
            <article key={item.id} className={`flex min-w-0 items-start gap-3 border-b border-border px-4 py-5 last:border-b-0 sm:px-6 ${!item.is_read ? 'border-l-4 border-l-primary bg-surface' : ''}`}>
              <span aria-hidden="true" className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-primary-strong"><NotificationGlyph kind={item.category} /></span>
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <h2 className={`${item.is_read ? 'font-medium' : 'font-bold'} text-text-dark`}>{!item.is_read ? <span className="mr-2 inline-block rounded border border-primary-strong px-1.5 py-0.5 text-xs font-semibold text-primary-strong">Unread</span> : null}{item.title}</h2>
                {item.body ? <p className="mt-1 text-sm text-text-body">{item.body}</p> : null}
                <time dateTime={item.created_at} className="mt-1 block text-sm text-text-body">{relativeTime(item.created_at)}</time>
                {hrefOf(item) ? <Button variant="ghost" className="mt-2" disabled={busy} aria-label={`View notification: ${item.title}`} onClick={() => void open(item)}>View details</Button> : !item.is_read ? <Button variant="ghost" className="mt-2" disabled={busy} aria-label={`Mark as read: ${item.title}`} onClick={() => void open(item)}>Mark as read</Button> : null}
                {/* Mounted before any result, so that its arrival is read out,
                    and without height until it has a message. */}
                <div id={feedbackId(item.id)} tabIndex={-1} className={actionId === item.id && (actionError || success) ? 'mt-2 scroll-mt-24' : 'h-0 overflow-hidden'}>
                  <FormMessage error={actionId === item.id ? actionError : null} success={actionId === item.id ? success : null} />
                </div>
              </div>
            </article>
          ))
        )}
      </Card>
      )}
    </div>
  );
}

function NotificationGlyph({ kind }: { kind: string }) {
  if (/message|enquiry/.test(kind)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5" aria-hidden><path d="M4 4h16v12H9l-5 4V4Z" /></svg>;
  if (/review/.test(kind)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5" aria-hidden><path d="m12 3 3 6 6 1-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 10l6-1 3-6Z" /></svg>;
  if (/connection|network/.test(kind)) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5" aria-hidden><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v2" /></svg>;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5" aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
