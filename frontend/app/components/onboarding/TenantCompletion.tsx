'use client';

import Link from 'next/link';
import CompletionBar from '@/app/components/onboarding/CompletionBar';
import CompletionRow from '@/app/components/onboarding/CompletionRow';
import FinishSetupPrompt from '@/app/components/onboarding/FinishSetupPrompt';
import ButtonLink from '@/app/components/ui/ButtonLink';
import Card from '@/app/components/ui/Card';
import {
  COMPLETION_HREFS,
  COMPLETION_STATUS_LABELS,
  type CompletionItem,
  type CompletionStatus,
  type MyProfile,
} from '@/app/lib/my-profile';

/** The reference page's sections, by the server's row keys; a row the server adds later shows under "Other". */
const SECTIONS: { title: string; keys: string[] }[] = [
  { title: 'Personal details', keys: ['personal_details', 'employment'] },
  {
    title: 'Verification documents',
    keys: ['primary_id', 'secondary_id', 'proof_of_address', 'income_documents', 'employment_contract', 'payslips', 'bank_statements'],
  },
  {
    title: 'Rental readiness',
    keys: ['rental_history', 'property_preferences', 'availability', 'owner_reference', 'employer_reference'],
  },
  { title: 'Reviews', keys: ['property_review', 'received_references'] },
];

const STATUS_STYLES: Record<CompletionStatus, string> = {
  started: 'border border-warning bg-white text-warning',
  almost_ready: 'bg-surface text-primary-strong',
  ready: 'bg-[#e7f8ef] text-success',
};

const sectionId = (title: string) => `completion-${title.toLowerCase().replace(/\W+/g, '-')}`;

function grouped(items: CompletionItem[]) {
  const placed = new Set(SECTIONS.flatMap((section) => section.keys));
  return [
    ...SECTIONS.map((section) => ({
      title: section.title,
      items: section.keys.flatMap((key) => items.filter((item) => item.key === key)),
    })),
    { title: 'Other', items: items.filter((item) => !placed.has(item.key)) },
  ].filter((section) => section.items.length > 0);
}

/**
 * A tenant's renter profile completion, as the server works it out
 * (services/profile_completion.py) and GET /profiles/me sends it: the score,
 * where required rows (70 %) and boosters (30 %) stand, and every row with
 * where to complete it. Nothing here is worked out in the browser.
 */
export default function TenantCompletion({ profile }: { profile: MyProfile }) {
  const completion = profile.completion;
  if (!completion) {
    return (
      <Card className="p-6">
        <p className="text-sm text-text-body">A completion score is worked out for tenant accounts.</p>
      </Card>
    );
  }
  const ready = completion.status === 'ready';
  const listed = profile.settings.privacy.public_profile;

  return (
    <div className="space-y-6">
      <FinishSetupPrompt role="tenant" offerStart />
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-heading text-4xl font-bold text-text-dark">{completion.score}%</p>
            <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[completion.status]}`}>
              {COMPLETION_STATUS_LABELS[completion.status]}
            </span>
            <p className="mt-2 text-sm text-text-body">Worked out from the details saved to your account.</p>
          </div>
          {listed ? (
            <ButtonLink href={`/public/${profile.id}`} variant="secondary">
              Preview public profile
            </ButtonLink>
          ) : (
            <p className="max-w-xs text-sm text-text-body">
              Your profile is hidden from profile search.{' '}
              <Link href="/tenant/settings" className="font-semibold text-primary-strong underline">
                Change this in your settings
              </Link>
            </p>
          )}
        </div>
        <CompletionBar label="Core requirements" done={completion.required_done} total={completion.required_total} />
        <CompletionBar label="Trust score boosters" done={completion.boosters_done} total={completion.boosters_total} />
        <p className="mt-4 text-sm text-text-body">
          {ready
            ? 'Every required section is complete, so your profile is ready to share with owners.'
            : 'Complete every required section to make your profile ready to share with owners.'}
        </p>
      </Card>

      {grouped(completion.items).map((section) => (
        <section
          key={section.title}
          aria-labelledby={sectionId(section.title)}
          className="overflow-hidden rounded-2xl border border-border bg-white"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-5 py-3">
            <h2 id={sectionId(section.title)} className="font-heading text-base font-semibold text-text-dark">
              {section.title}
            </h2>
            <span className="shrink-0 text-sm text-text-body">
              {section.items.filter((item) => item.done).length} of {section.items.length} done
            </span>
          </div>
          <ul className="divide-y divide-border">
            {section.items.map((item) => (
              <CompletionRow
                key={item.key}
                label={item.label}
                description={item.description}
                kind={item.kind}
                state={item.done ? 'done' : item.available ? 'todo' : 'unavailable'}
                href={item.available ? COMPLETION_HREFS[item.key] : undefined}
              />
            ))}
          </ul>
        </section>
      ))}
      {completion.items.some((item) => !item.available) ? (
        <p className="text-sm text-text-body">
          Owner scorecards do not count towards your completion yet, so the rows that need them cannot be completed.
        </p>
      ) : null}
    </div>
  );
}
