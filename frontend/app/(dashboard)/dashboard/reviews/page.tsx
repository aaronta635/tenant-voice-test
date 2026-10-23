'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import FormMessage from '@/app/components/ui/FormMessage';
import EmptyState from '@/app/components/ui/EmptyState';
import FilterChip from '@/app/components/ui/FilterChip';
import Modal from '@/app/components/ui/Modal';
import StatCard from '@/app/components/ui/StatCard';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { api, ApiError, orNotFound, type Review } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatDate, initialsOf } from '@/app/lib/format';

export default function ReviewsPage() {
  const [hasProvider, setHasProvider] = useState(false);
  const [reporting, setReporting] = useState<Review | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [items, setItems] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [replyFilter, setReplyFilter] = useState<'all' | 'replied' | 'awaiting'>('all');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const provider = await orNotFound(api.providers.mine(), null);
        if (!active) return;
        setHasProvider(Boolean(provider));
        if (provider) {
          const reviews = await api.providers.myReviews();
          if (active) setItems(reviews);
        }
      } catch (err) { if (active) setLoadError(err instanceof Error ? err.message : 'Could not load reviews.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    if (replyFilter === 'all') return items;
    return items.filter((r) =>
      r.id === actionId || (replyFilter === 'replied' ? !!r.provider_reply : !r.provider_reply),
    );
  }, [items, replyFilter, actionId]);

  const avg = items.reduce((sum, r) => sum + r.rating, 0) / Math.max(items.length, 1);
  const awaiting = items.filter((r) => !r.provider_reply).length;

  async function submitReply(id: string) {
    const text = drafts[id]?.trim();
    if (!text) return;
    if (busyId) return;
    setActionId(id); setNotice(null);
    setBusyId(id);
    setError(null);
    try {
      const updated = await api.reviews.reply(id, text);
      setItems((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setDrafts((d) => ({ ...d, [id]: '' }));
      setNotice('Reply posted.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post that reply.');
    } finally {
      setBusyId(null);
    }
  }

  async function flagReview(id: string) {
    setReporting(null);
    if (busyId) return;
    setActionId(id); setNotice(null);
    setBusyId(id);
    setError(null);
    try {
      const updated = await api.reviews.flag(id);
      setItems((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setNotice('Review reported for moderation.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not report that review.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-h2 font-semibold text-text-dark">
          Reviews
        </h1>
        <p className="mt-1 text-[#5f6b76]">
          Monitor your reputation, respond to clients, and build trust.
        </p>
      </div>

      {!loading && !loadError && hasProvider ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Overall rating"
          value={items.length ? avg.toFixed(1) : '—'}
          hint={`${items.length} ${items.length === 1 ? "review" : "reviews"}`}
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
      </div> : null}

      {!loading && !loadError && hasProvider ? <div role="group" aria-label="Filter reviews" className="mt-6 flex flex-wrap gap-2">
        {(
          [
            ['all', 'All'],
            ['awaiting', 'Awaiting response'],
            ['replied', 'Replied'],
          ] as const
        ).map(([id, label]) => (
          <FilterChip
            key={id}
            selected={replyFilter === id}
            onClick={() => { setReplyFilter(id); setActionId(null); }}
          >
            {label}
          </FilterChip>
        ))}
      </div> : null}

      <div className="mt-6 space-y-4">
        {loading ? (
          <p role="status" className="text-[#5f6b76]">Loading reviews…</p>
        ) : loadError ? (
          <LoadErrorCard
            message={loadError}
            onRetry={() => {
              setLoading(true);
              setLoadError(null);
              setReloadKey((k) => k + 1);
            }}
          />
        ) : !hasProvider ? <EmptyState title="Create your provider profile" description="Complete onboarding before you start receiving reviews." action={<Link href="/dashboard/onboarding" className="font-bold text-primary-strong underline">Start onboarding</Link>} /> : filtered.length === 0 ? (
          <EmptyState title="No reviews in this view" description="Reviews from completed bookings will appear here." />
        ) : (
          filtered.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              draft={drafts[review.id] ?? ''}
              busy={busyId === review.id}
              onDraftChange={(value) => setDrafts((d) => ({ ...d, [review.id]: value }))}
              onSubmit={() => submitReply(review.id)}
              error={actionId === review.id ? error : null}
              notice={actionId === review.id ? notice : null}
              onFlag={() => setReporting(review)}
            />
          ))
        )}
      </div>
      <Modal open={!!reporting} title="Report review?" onClose={() => setReporting(null)} busy={!!busyId}>
        <p>Report {reporting?.client_name ?? 'this client'}’s review? The trust team will check it against the review guidelines.</p>
        <div className="mt-4 flex gap-2"><button className="min-h-11 rounded-lg border px-4" onClick={() => setReporting(null)}>Cancel</button><button className="min-h-11 rounded-lg border border-danger px-4 text-danger" onClick={() => reporting && void flagReview(reporting.id)}>Report review</button></div>
      </Modal>
    </div>
  );
}

function ReviewCard({
  review,
  draft,
  busy,
  onDraftChange,
  onSubmit,
  onFlag,
  error,
  notice,
}: {
  review: Review;
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onFlag: () => void;
  error: string | null;
  notice: string | null;
}) {
  const replied = !!review.provider_reply;
  const card = useRef<HTMLElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  // Move focus to the result, unless the provider has moved on while it
  // saved, say to another review's reply or the header search.
  useEffect(() => { if (error || notice) focusResult(feedback.current, card.current); }, [error, notice]);

  return (
    <article ref={card} className="rounded-xl border border-border bg-white shadow-sm p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <div aria-hidden="true" className="flex size-11 items-center justify-center shrink-0 rounded-full bg-surface text-xs font-bold text-navy">
            {initialsOf(review.client_name)}
          </div>
          <div>
            <h2 className="font-bold text-[#1b1b1f]">{review.client_name ?? 'Verified client'}</h2>
            <p className="text-xs text-[#5f6b76]">
              {[review.service_title, review.location, formatDate(review.created_at)]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p
              className="mt-1 text-sm font-semibold text-[#0e2a48]"
              role="img"
              aria-label={`${review.rating} out of 5 stars`}
            >
              {'★'.repeat(review.rating)}
              {'☆'.repeat(5 - review.rating)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-bold ${
              replied ? 'bg-[#e6f4ed] text-[#1b7c4f]' : 'bg-[#fff4e5] text-warning'
            }`}
          >
            {replied ? 'Replied' : 'Awaiting response'}
          </span>
          {review.is_flagged ? (
            <span className="rounded-full bg-[#fdecee] px-2.5 py-1 text-xs font-bold text-[#a12b3b]">
              Reported · under review
            </span>
          ) : (
            <button
              type="button"
              aria-label={`Report review by ${review.client_name ?? "client"}`}
              onClick={onFlag}
              disabled={busy}
              className="min-h-11 rounded-lg px-3 py-2 text-xs font-semibold text-[#5f6b76] ring-1 ring-[#efeff2] hover:text-[#a12b3b] hover:ring-[#f3c6c6] disabled:opacity-50"
            >
              Report
            </button>
          )}
        </div>
      </div>

      {review.comment ? (
        <p className="mt-4 text-sm leading-relaxed text-[#5f6b76]">{review.comment}</p>
      ) : null}

      {replied ? (
        <div className="mt-4 rounded-[14px] border border-control-border bg-[#fafafe] p-3">
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
            aria-label={`Post reply to ${review.client_name ?? "client"}`}
            onClick={onSubmit}
            disabled={busy || !draft.trim()}
            className="min-h-11 rounded-lg bg-primary-strong px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? 'Posting…' : 'Post reply'}
          </button>
        </div>
      )}
      <div ref={feedback} tabIndex={-1} className="mt-3 scroll-mt-24"><FormMessage error={error} success={notice} /></div>
    </article>
  );
}
