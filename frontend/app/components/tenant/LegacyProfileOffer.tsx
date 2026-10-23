'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import { hasTenantDetails, updateMyProfile, type MyProfile } from '@/app/lib/my-profile';
import {
  clearLegacyProfile,
  legacyPrivateDetails,
  legacyProfilePatch,
  legacyProfileSummary,
} from '@/app/lib/tenant-profile-extras';

/**
 * Details an older build kept in this browser, offered once to the account
 * that has none of its own yet. Nothing ties them to that account, so the
 * offer shows their values to recognise, and the private ones are only
 * named, to enter again by hand. Saving or declining clears them; when the
 * account already holds details, its copy wins and this browser's is
 * dropped without asking. Mounted once the profile has loaded, so the server
 * markup never holds it.
 */
export default function LegacyProfileOffer({
  profile,
  onSaved,
}: {
  profile: MyProfile;
  onSaved: (profile: MyProfile) => void;
}) {
  const accountHasDetails = hasTenantDetails(profile.tenant);
  const [patch] = useState(() => (accountHasDetails ? null : legacyProfilePatch()));
  const [privateDetails] = useState(() => (accountHasDetails ? [] : legacyPrivateDetails()));
  const [answer, setAnswer] = useState<'saving' | 'saved' | 'declined' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const result = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (accountHasDetails && answer === null) clearLegacyProfile();
  }, [accountHasDetails, answer]);

  useEffect(() => {
    if (answer === 'saved' || answer === 'declined') result.current?.focus();
  }, [answer]);

  if (!patch && !privateDetails.length) return null;
  if (answer === 'saved' || answer === 'declined') {
    return (
      <p ref={result} tabIndex={-1} role="status" className="mb-6 rounded-[12px] border border-success bg-white p-4 text-sm text-success">
        {answer === 'saved'
          ? 'The details from this browser are now saved to your account.'
          : 'The details saved in this browser were removed.'}
      </p>
    );
  }
  // The account gained details of its own meanwhile, from a form on this page.
  if (accountHasDetails) return null;

  async function save() {
    if (!patch) return;
    setAnswer('saving');
    setError(null);
    try {
      const saved = await updateMyProfile(patch);
      clearLegacyProfile();
      setAnswer('saved');
      onSaved(saved);
    } catch (err) {
      setAnswer(null);
      setError(err instanceof ApiError ? err.message : 'Could not save these details. Try again, or remove them.');
    }
  }

  function decline() {
    clearLegacyProfile();
    setAnswer('declined');
  }

  const saving = answer === 'saving';
  return (
    <section aria-labelledby="legacy-profile-offer" className="mb-6 rounded-[16px] border border-primary-strong bg-white p-5">
      <h2 id="legacy-profile-offer" className="font-heading text-lg font-semibold text-text-dark">
        Details saved in this browser
      </h2>
      {patch ? (
        <>
          <p className="mt-2 text-sm text-text-body">Before profiles were saved to accounts, this browser kept:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-dark">
            {legacyProfileSummary(patch).map((line) => <li key={line} className="break-words">{line}</li>)}
          </ul>
          <p className="mt-2 text-sm text-text-body">
            Save them to your account only if they are yours. Either way they are then removed from this browser.
          </p>
        </>
      ) : null}
      {privateDetails.length ? (
        <p className="mt-2 text-sm text-text-body">
          It also kept {privateDetails.join(', ')}. Those are not saved from here, as someone else may have used this
          browser: if they are yours, enter them again on their pages.
        </p>
      ) : null}
      <FormMessage error={error} className="mt-3" />
      <div className="mt-4 flex flex-wrap gap-3">
        {patch ? (
          <Button className="h-10 rounded-[8px]" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save to my account'}
          </Button>
        ) : null}
        <Button variant="secondary" className="h-10 rounded-[8px]" onClick={decline} disabled={saving}>
          Remove them
        </Button>
      </div>
    </section>
  );
}
