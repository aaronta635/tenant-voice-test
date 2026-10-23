'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';
import { getMyProfile, type MyProfile } from './my-profile';

/** The signed-in member's own profile for a page: loading, then the profile or an error to retry. */
export function useMyProfile() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getMyProfile()
      .then((me) => {
        if (active) setProfile(me);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load your profile.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setAttempt((count) => count + 1);
  }, []);

  return { profile, setProfile, loading, error, retry };
}
