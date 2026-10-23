'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/app/lib/api';

type Loaded<T> = { attempt: number; data: T | null; error: string | null };

/**
 * A portal page's data from one API call (lib/housing-api): loading until it
 * answers, then the data or the error's message; retry() asks again, and
 * replace() keeps what a change on the page sent back. `load` must keep its
 * identity across renders, as housingApi's calls do.
 */
export function useHousingData<T>(load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);

  useEffect(() => {
    let active = true;
    load().then(
      (data) => { if (active) setLoaded({ attempt, data, error: null }); },
      (error) => { if (active) setLoaded({ attempt, data: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [attempt, load]);

  const current = loaded?.attempt === attempt ? loaded : null;
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const replace = useCallback((change: (data: T) => T) => {
    setLoaded((previous) => (previous?.data ? { ...previous, data: change(previous.data) } : previous));
  }, []);
  return { loading: !current, data: current?.data ?? null, error: current?.error ?? null, retry, replace };
}
