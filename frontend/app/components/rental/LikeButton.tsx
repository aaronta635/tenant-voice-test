'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/app/lib/api';
import { mergeClasses } from '@/app/components/ui/merge-classes';

type Props = {
  listingId: string;
  count: number;
  liked: boolean;
  /** Tenants like listings; everyone else sees the count. */
  canLike: boolean;
  /** Signed out, the heart is a sign-in link that comes back here. */
  signInHref: string | null;
};

const PILL = 'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold';

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.9 3.8 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.4 0 5.5 3.4 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4Z" />
    </svg>
  );
}

const likes = (count: number) => `${count.toLocaleString('en-AU')} ${count === 1 ? 'like' : 'likes'}`;

/** Like a listing (listing_favorites): a toggle for tenants, a sign-in link signed out, a count for others. */
export default function LikeButton({ listingId, count, liked, canLike, signInHref }: Props) {
  const [state, setState] = useState({ liked, count });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canLike) {
    if (signInHref) {
      return (
        <Link href={signInHref} className={mergeClasses(PILL, 'border-control-border bg-white text-text-dark hover:bg-surface')}>
          <Heart filled={false} />
          <span>Like</span>{' '}
          <span className="font-normal text-text-body">· {state.count.toLocaleString('en-AU')}</span>
          <span className="sr-only">: sign in to like this listing ({likes(state.count)})</span>
        </Link>
      );
    }
    return (
      <p className={mergeClasses(PILL, 'border-border bg-white font-medium text-text-body')}>
        <Heart filled={false} />
        {likes(state.count)}
      </p>
    );
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = state.liked ? await api.properties.unlike(listingId) : await api.properties.like(listingId);
      setState({ liked: result.liked, count: result.like_count });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Your like was not saved. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        aria-pressed={state.liked}
        aria-label={`${state.liked ? 'Liked' : 'Like this listing'}, ${likes(state.count)}`}
        disabled={busy}
        onClick={() => void toggle()}
        className={mergeClasses(
          PILL,
          'cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong disabled:cursor-not-allowed disabled:opacity-60',
          state.liked ? 'border-danger bg-white text-danger' : 'border-control-border bg-white text-text-dark hover:bg-surface',
        )}
      >
        <Heart filled={state.liked} />
        <span aria-hidden>{state.liked ? 'Liked' : 'Like'}</span>{' '}
        <span aria-hidden className="font-normal text-text-body">· {state.count.toLocaleString('en-AU')}</span>
      </button>
      {error ? <span role="alert" className="text-sm text-danger">{error}</span> : null}
    </span>
  );
}
