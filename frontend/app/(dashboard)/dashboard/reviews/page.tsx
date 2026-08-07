'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, safe, type Review } from '@/app/lib/api';
import { formatDate, initialsOf } from '@/app/lib/format';

export default function ReviewsPage() {
  const [items, setItems] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyFilter, setReplyFilter] = useState<'all' | 'replied' | 'awaiting'>('all');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    safe(api.providers.myReviews(), []).then((reviews) => {
      if (!active) return;
      setItems(reviews);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (replyFilter === 'all') return items;
    return items.filter((r) =>
      replyFilter === 'replied' ? !!r.provider_reply : !r.provider_reply,
    );
  }, [items, replyFilter]);

  const avg = items.reduce((sum, r) => sum + r.rating, 0) / Math.max(items.length, 1);
  const awaiting = items.filter((r) => !r.provider_reply).length;

  async function submitReply(id: string) {
    const text = drafts[id]?.trim();
    if (!text) return;
    setBusyId(id);
    setError(null);
    try {
      const updated = await api.reviews.reply(id, text);
      setItems((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setDrafts((d) => ({ ...d, [id]: '' }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post that reply.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[32px] font-extrabold tracking-tight text-[#1b1b1f]">
          Reviews Management
        </h1>
        <p className="mt-1 text-[#5f6b76]">
          Monitor your reputation, respond to clients, and build trust.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Overall rating"
          value={items.length ? avg.toFixed(1) : '—'}
          hint={`${items.length} reviews`}
        />
        <StatCard
          label="Awaiting response"
          value={String(awaiting)}
          hint="Reply to keep trust high"
        />
        <StatCard
          label="Response rate"
          value={
            items.length
              ? `${Math.round(((items.length - awaiting) / items.length) * 100)}%`
              : '—'
          }
          hint="Of reviews answered"
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {(
          [
            ['all', 'All'],
            ['awaiting', 'Awaiting response'],
            ['replied', 'Replied'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setReplyFilter(id)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
              replyFilter === id
                ? 'bg-[#0e2a48] text-white'
                : 'bg-white text-[#5f6b76] ring-1 ring-[#efeff2]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-4 rounded-[12px] border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        {loading ? (
          <p className="text-[#5f6b76]">Loading reviews…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[#c5cad3] bg-white p-10 text-center text-[#5f6b76]">
            No reviews in this view yet.
          </div>
        ) : (
          filtered.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              draft={drafts[review.id] ?? ''}
              busy={busyId === review.id}
              onDraftChange={(value) => setDrafts((d) => ({ ...d, [review.id]: value }))}
              onSubmit={() => submitReply(review.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[18px] border border-[#efeff2] bg-white p-5">
      <p className="text-xs font-bold tracking-wide text-[#8c97a2] uppercase">{label}</p>
      <p className="mt-2 text-3xl font-extrabold text-[#1b1b1f]">{value}</p>
      <p className="text-sm text-[#5f6b76]">{hint}</p>
    </div>
  );
}

function ReviewCard({
  review,
  draft,
  busy,
  onDraftChange,
  onSubmit,
}: {
  review: Review;
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const replied = !!review.provider_reply;

  return (
    <article className="rounded-[20px] border border-[#efeff2] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="flex size-11 items-center justify-center rounded-full bg-[#eeeffd] text-xs font-bold text-[#0e2a48]">
            {initialsOf(review.client_name)}
          </div>
          <div>
            <p className="font-bold text-[#1b1b1f]">{review.client_name ?? 'Verified client'}</p>
            <p className="text-xs text-[#8c97a2]">
              {[review.service_title, review.location, formatDate(review.created_at)]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="mt-1 text-sm font-semibold text-[#0e2a48]">
              {'★'.repeat(review.rating)}
              {'☆'.repeat(5 - review.rating)}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
            replied ? 'bg-[#e6f4ed] text-[#1b7c4f]' : 'bg-[#fff4e5] text-[#b86e00]'
          }`}
        >
          {replied ? 'Replied' : 'Awaiting response'}
        </span>
      </div>

      {review.comment ? (
        <p className="mt-4 text-sm leading-relaxed text-[#5f6b76]">{review.comment}</p>
      ) : null}

      {replied ? (
        <div className="mt-4 rounded-[14px] border border-[#efeff2] bg-[#fafafe] p-3">
          <p className="text-xs font-bold text-[#0e2a48]">
            Your reply · {formatDate(review.replied_at)}
          </p>
          <p className="mt-1 text-sm text-[#5f6b76]">{review.provider_reply}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <label className="sr-only" htmlFor={`reply-${review.id}`}>
            Public reply
          </label>
          <textarea
            id={`reply-${review.id}`}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={3}
            placeholder="Write a public reply..."
            className="w-full rounded-[12px] border border-[#efeff2] px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !draft.trim()}
            className="h-9 rounded-full bg-primary px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Posting…' : 'Post reply'}
          </button>
        </div>
      )}
    </article>
  );
}
