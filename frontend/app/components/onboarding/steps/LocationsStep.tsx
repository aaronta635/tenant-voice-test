'use client';

import { useState, type KeyboardEvent } from 'react';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import { focusSoon, useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import { HINT } from '@/app/components/onboarding/styles';
import type { TenantDetails } from '@/app/lib/my-profile';

const MAX_PLACES = 10;
const MAX_LENGTH = 80;
// Fewer than this and the reference suggests adding more.
const GOOD_MATCHES = 3;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** places with typed added, unless it is blank or already there. */
function withPlace(places: string[], typed: string): string[] {
  const place = typed.trim();
  return !place || places.some((item) => same(item, place)) ? places : [...places, place];
}

/** The suburbs a tenant would like to live in (reference step 5): public, on their profile. */
export default function LocationsStep({ profile, handle }: StepProps) {
  const tenant = profile.tenant as TenantDetails;
  const [places, setPlaces] = useState(tenant.preferred_locations);
  const [typed, setTyped] = useState('');
  const full = places.length >= MAX_PLACES;

  useStepAnswers(handle, () => {
    // A suburb typed but not added yet counts: moving on should not drop it.
    const next = withPlace(places, typed);
    if (next.length > MAX_PLACES) return { problem: `Choose up to ${MAX_PLACES} suburbs.`, field: 'onboarding-place' };
    if (JSON.stringify(next) === JSON.stringify(tenant.preferred_locations)) return null;
    return { patch: { tenant: { preferred_locations: next } } };
  });

  function add() {
    const next = withPlace(places, typed);
    setPlaces(next);
    setTyped('');
    // Add disables itself once the field clears: the next suburb is typed where the last one was.
    focusSoon(next.length >= MAX_PLACES ? 'onboarding-places' : 'onboarding-place');
  }

  function remove(index: number) {
    const next = places.filter((_, place) => place !== index);
    setPlaces(next);
    // The pressed Remove is gone: the next suburb's takes focus, else the field.
    focusSoon(next.length ? `onboarding-place-remove-${Math.min(index, next.length - 1)}` : 'onboarding-place');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    add();
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              id="onboarding-place"
              label="Suburb or postcode"
              placeholder="Newtown"
              maxLength={MAX_LENGTH}
              disabled={full}
              aria-describedby="onboarding-place-hint"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <Button variant="secondary" onClick={add} disabled={full || !typed.trim()}>
            Add
          </Button>
        </div>
        <p id="onboarding-place-hint" className={HINT}>
          {full ? `You have added the most suburbs you can, ${MAX_PLACES}.` : `Press Enter or Add after each one, up to ${MAX_PLACES}.`}
        </p>
      </div>

      {places.length === 0 ? (
        <p className="rounded-xl border border-dashed border-control-border px-4 py-6 text-center text-sm text-text-body">
          No suburbs added yet.
        </p>
      ) : (
        <ul id="onboarding-places" tabIndex={-1} aria-label="Suburbs you added" className="flex flex-wrap gap-2">
          {places.map((place, index) => (
            <li key={place} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-surface pl-3 text-sm font-semibold text-primary-strong">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4 shrink-0" aria-hidden>
                <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" />
                <circle cx="12" cy="9.5" r="2.5" />
              </svg>
              <span className="break-all">{place}</span>
              <button
                id={`onboarding-place-remove-${index}`}
                type="button"
                aria-label={`Remove ${place}`}
                onClick={() => remove(index)}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-white"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {places.length > 0 && places.length < GOOD_MATCHES ? (
        <p className="rounded-xl border border-warning bg-white px-4 py-3 text-sm text-warning">
          Add at least {GOOD_MATCHES} suburbs for better matches.
        </p>
      ) : null}
      <p className="text-xs text-text-body">Your suburbs show on your public profile, so owners can see where you want to live.</p>
    </div>
  );
}
