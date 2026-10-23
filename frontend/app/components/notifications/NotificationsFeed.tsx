'use client';

import { useEffect, useState } from 'react';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import { api, ApiError, type NotificationItem } from '@/app/lib/api';
import { relativeTime } from '@/app/lib/format';

export default function NotificationsFeed({
  title = 'Notifications',
  description = 'Application updates, messages, and account alerts.',
}: {
  title?: string;
  description?: string;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.notifications
      .list()
      .then((list) => {
        if (!active) return;
        setItems(list);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : 'Could not load notifications.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function retryLoad() {
    setLoading(true);
    setError(null);
    api.notifications
      .list()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load notifications.');
      })
      .finally(() => setLoading(false));
  }

  const unread = items.filter((item) => !item.is_read).length;

  async function markAll() {
    try {
      await api.notifications.markAllRead();
      setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
    } catch {
      setError('Could not mark notifications as read.');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#171a1f]">{title}</h1>
          <p className="mt-1 text-sm text-[#565d6d]">{description}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-[#f0f1ff] px-3 py-1 text-sm font-medium text-primary">
            {unread} unread
          </span>
          <Button className="h-10 rounded-[8px]" onClick={markAll} disabled={unread === 0}>
            Mark all as read
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden rounded-[12px] border border-[#dee1e6]">
        {loading ? (
          <p className="px-6 py-8 text-center text-sm text-[#565d6d]">Loading…</p>
        ) : error ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-[#de3b40]">{error}</p>
            <Button variant="secondary" className="mt-4 h-10 rounded-[8px]" onClick={retryLoad}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-[#565d6d]">No notifications yet.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-4 border-b border-[#f1f5f9] px-6 py-5 last:border-b-0"
            >
              <span className="mt-1 flex size-10 items-center justify-center rounded-full bg-[#f0f1ff] text-primary">
                🔔
              </span>
              <div className="flex-1">
                <p className="font-medium text-[#171a1f]">{item.title}</p>
                {item.body ? <p className="mt-1 text-sm text-[#565d6d]">{item.body}</p> : null}
                <p className="mt-1 text-sm text-[#565d6d]">{relativeTime(item.created_at)}</p>
              </div>
              {!item.is_read ? <span className="mt-2 size-2 rounded-full bg-primary" /> : null}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
