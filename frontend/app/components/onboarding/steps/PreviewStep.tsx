'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ProfileCard from '@/app/components/public-profiles/ProfileCard';
import { useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import { NOTE } from '@/app/components/onboarding/styles';
import Button from '@/app/components/ui/Button';
import { ApiError } from '@/app/lib/api';
import { landlordSetup } from '@/app/lib/landlord-setup';
import { COMPLETION_STATUS_LABELS, getMyProfile, type MyProfile } from '@/app/lib/my-profile';
import { documentsApi, type DocumentChecklist } from '@/app/lib/profile-documents';
import { getPublicProfile, type PublicProfileDetail } from '@/app/lib/public-profiles';

type Preview = {
  /** Read again: documents uploaded on the way here move a tenant's completion. */
  profile: MyProfile;
  /** The public card as anyone sees it; null while the member is hidden from search. */
  card: PublicProfileDetail | null;
  /** A landlord's documents checklist, for what verification still needs. */
  documents: DocumentChecklist | null;
};

type Loaded = { attempt: number; preview: Preview | null; error: string | null };

/** The public card hidden members do not have: the API answers 404 for them. */
async function publicCard(id: string): Promise<PublicProfileDetail | null> {
  try {
    return await getPublicProfile(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * How the profile looks to others (reference step 18): the card the public
 * profile API sends, and what the server says is still missing. Nothing on
 * it saves.
 */
export default function PreviewStep({ profile, handle }: StepProps) {
  const landlord = profile.tenant === null;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = loaded?.attempt === attempt ? loaded : null;
  useStepAnswers(handle, () => null);

  useEffect(() => {
    let active = true;
    Promise.all([getMyProfile(), publicCard(profile.id), landlord ? documentsApi.checklist() : Promise.resolve(null)]).then(
      ([me, card, documents]) => {
        if (active) setLoaded({ attempt, preview: { profile: me, card, documents }, error: null });
      },
      (error) => {
        if (active) setLoaded({ attempt, preview: null, error: error instanceof ApiError ? error.message : 'Please try again.' });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, profile.id, landlord]);

  if (!current) return <p role="status" className="text-sm text-text-body">Loading your preview…</p>;
  if (!current.preview) {
    return (
      <div className="rounded-xl border border-border bg-background p-5 text-center">
        <p className="font-semibold text-text-dark">Your preview could not be loaded</p>
        <p className="mt-1 text-sm text-text-body">{current.error}</p>
        <Button variant="secondary" className="mt-4" onClick={() => setAttempt((count) => count + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  const { profile: me, card, documents } = current.preview;
  return (
    <div className="space-y-6">
      <section aria-labelledby="onboarding-preview-card">
        <h2 id="onboarding-preview-card" className="text-sm font-semibold text-text-dark">
          Your card in profile search
        </h2>
        <div className="mt-3 max-w-sm">
          {card ? (
            <ProfileCard profile={card} />
          ) : (
            <p className={NOTE}>Your profile is hidden from profile search, so nobody else sees it. You can show it in the next step.</p>
          )}
        </div>
      </section>
      {me.tenant ? (
        <ul className="grid grid-cols-3 gap-3 text-center">
          <Stat value={me.tenant.rental_history.length} label="Addresses" />
          <Stat value={me.tenant.preferred_locations.length} label="Suburbs" />
          <Stat value={me.tenant.qualities.tags.length} label="Qualities" />
        </ul>
      ) : null}
      {me.completion ? <TenantSummary profile={me} /> : documents ? <LandlordSummary profile={me} documents={documents} /> : null}
      <p className="text-center text-xs text-text-body">You can change every answer later from your profile.</p>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <li className="rounded-xl border border-border bg-white px-2 py-3">
      <p className="font-heading text-2xl font-bold text-primary-strong">{value}</p>
      <p className="text-xs text-text-body">{label}</p>
    </li>
  );
}

/** The server's completion: its score, and the required rows still to do. */
function TenantSummary({ profile }: { profile: MyProfile }) {
  const completion = profile.completion!;
  const missing = completion.items.filter((item) => item.kind === 'required' && item.available && !item.done);
  return (
    <section aria-labelledby="onboarding-preview-summary" className={NOTE}>
      <h2 id="onboarding-preview-summary" className="font-semibold text-text-dark">
        Your renter profile is {completion.score}% complete · {COMPLETION_STATUS_LABELS[completion.status]}
      </h2>
      {missing.length ? (
        <>
          <p className="mt-2">Still required to be ready to share:</p>
          <ul className="mt-1 list-disc pl-5">
            {missing.map((item) => <li key={item.key}>{item.label}</li>)}
          </ul>
        </>
      ) : (
        <p className="mt-2">Every required section is complete.</p>
      )}
      <Link href="/tenant/profile-completion" className="mt-3 inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
        See your profile completion
      </Link>
    </section>
  );
}

/** A landlord's setup checklist: their details, and each verification requirement as the server reports it. */
function LandlordSummary({ profile, documents }: { profile: MyProfile; documents: DocumentChecklist }) {
  const required = landlordSetup(profile, documents).filter((item) => item.kind === 'required');
  const missing = required.filter((item) => !item.done);
  return (
    <section aria-labelledby="onboarding-preview-summary" className={NOTE}>
      <h2 id="onboarding-preview-summary" className="font-semibold text-text-dark">
        {required.length - missing.length} of {required.length} required items done
      </h2>
      {missing.length ? (
        <ul className="mt-2 list-disc pl-5">
          {missing.map((item) => <li key={item.key}>{item.label}</li>)}
        </ul>
      ) : (
        <p className="mt-2">Every required item is done.</p>
      )}
      <Link href="/owner/profile/completion" className="mt-3 inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
        See your profile completion
      </Link>
    </section>
  );
}
