'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import CompletionBar from '@/app/components/onboarding/CompletionBar';
import CompletionRow from '@/app/components/onboarding/CompletionRow';
import FinishSetupPrompt from '@/app/components/onboarding/FinishSetupPrompt';
import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { ApiError } from '@/app/lib/api';
import { landlordSetup, type SetupItem } from '@/app/lib/landlord-setup';
import { getMyProfile, type MyProfile } from '@/app/lib/my-profile';
import { documentsApi, STATUS_LABELS, VERIFICATION_LABELS, type DocumentChecklist } from '@/app/lib/profile-documents';

type Loaded = { attempt: number; profile: MyProfile | null; documents: DocumentChecklist | null; error: string | null };

function Section({ title, items }: { title: string; items: SetupItem[] }) {
  const id = `setup-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-2xl border border-border bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-5 py-3">
        <h2 id={id} className="font-heading text-base font-semibold text-text-dark">
          {title}
        </h2>
        <span className="shrink-0 text-sm text-text-body">
          {items.filter((item) => item.done).length} of {items.length} done
        </span>
      </div>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <CompletionRow
            key={item.key}
            label={item.label}
            description={item.description}
            kind={item.kind}
            state={item.done ? 'done' : 'todo'}
            stateLabel={item.status ? STATUS_LABELS[item.status] : undefined}
            href={item.href}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * A landlord's or agent's setup checklist (lib/landlord-setup): their own
 * details from GET /profiles/me and each verification requirement with the
 * status GET /me/documents gives it. The server works out a completion score
 * for renter profiles only, so this page counts items instead of a score.
 */
export default function LandlordCompletion() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = loaded?.attempt === attempt ? loaded : null;

  useEffect(() => {
    let active = true;
    Promise.all([getMyProfile(), documentsApi.checklist()]).then(
      ([profile, documents]) => {
        if (active) setLoaded({ attempt, profile, documents, error: null });
      },
      (error) => {
        if (active) {
          setLoaded({ attempt, profile: null, documents: null, error: error instanceof ApiError ? error.message : 'Please try again.' });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  if (!current) return <p role="status" className="text-sm text-text-body">Loading your profile…</p>;
  const { profile, documents } = current;
  if (!profile || !documents) {
    return (
      <LoadErrorCard
        title="Your profile could not be loaded"
        message={current.error ?? undefined}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  }
  if (!profile.landlord) {
    return (
      <Card className="p-6">
        <p className="text-sm text-text-body">This checklist is for landlord and agent accounts.</p>
      </Card>
    );
  }

  const items = landlordSetup(profile, documents);
  const required = items.filter((item) => item.kind === 'required');
  const boosters = items.filter((item) => item.kind === 'booster');
  const requiredDone = required.filter((item) => item.done).length;
  const listed = profile.settings.privacy.public_profile;

  return (
    <div className="min-w-0 space-y-6">
      <FinishSetupPrompt role="landlord" offerStart />
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-2xl font-bold text-text-dark">
              {requiredDone} of {required.length} required items done
            </h2>
            <p className="mt-1 text-sm text-text-body">Account verification: {VERIFICATION_LABELS[documents.account.status]}.</p>
            <p className="mt-1 text-sm text-text-body">Counted from the details and documents saved to your account.</p>
          </div>
          {listed ? (
            <ButtonLink href={`/public/${profile.id}`} variant="secondary">
              Preview public profile
            </ButtonLink>
          ) : (
            <p className="max-w-xs text-sm text-text-body">
              Your profile is hidden from profile search.{' '}
              <Link href="/owner/profile/settings" className="font-semibold text-primary-strong underline">
                Change this in your settings
              </Link>
            </p>
          )}
        </div>
        <CompletionBar label="Required items" done={requiredDone} total={required.length} />
        <CompletionBar label="Profile boosters" done={boosters.filter((item) => item.done).length} total={boosters.length} />
      </Card>
      <Section title="Your profile" items={items.filter((item) => item.group === 'profile')} />
      <Section title="Verification" items={items.filter((item) => item.group === 'verification')} />
    </div>
  );
}
