'use client';

import { useEffect, useState } from 'react';
import ButtonLink from '@/app/components/ui/ButtonLink';
import {
  ONBOARDING_HREF,
  onboardingApi,
  setupUnfinished,
  type OnboardingProgress,
  type OnboardingRole,
} from '@/app/lib/onboarding';
import { stepLabel } from '@/app/lib/onboarding-steps';

type Props = {
  role: OnboardingRole;
  /** Also invite a member who never started setup, such as an account the mobile app made. */
  offerStart?: boolean;
  className?: string;
};

/**
 * "Finish setup" for a member who skipped onboarding or closed it part way,
 * with the step they will resume at. A finished setup shows nothing, and so
 * does one never started unless offerStart asks for it. Nothing shows while
 * the progress loads or when it cannot: the prompt is only a nudge.
 */
export default function FinishSetupPrompt({ role, offerStart = false, className = '' }: Props) {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);

  useEffect(() => {
    let active = true;
    onboardingApi.get().then(
      (saved) => {
        if (active) setProgress(saved);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  if (!progress || progress.completed_at || progress.role !== role) return null;
  const unfinished = setupUnfinished(progress);
  if (!unfinished && !offerStart) return null;
  const resumesAt = stepLabel(role, progress.step);

  return (
    <section
      aria-labelledby={`finish-setup-${role}`}
      className={`flex flex-col gap-4 rounded-2xl border border-primary-strong bg-surface p-5 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="min-w-0">
        <h2 id={`finish-setup-${role}`} className="font-heading text-lg font-semibold text-text-dark">
          {unfinished ? 'Finish setting up your profile' : 'Set up your profile step by step'}
        </h2>
        <p className="mt-1 text-sm text-text-body">
          {unfinished
            ? resumesAt
              ? `Your answers so far are saved. Pick up at "${resumesAt}".`
              : 'You skipped setup. It takes a few minutes, and each step saves as you go.'
            : 'Each step saves as you go, so you can stop and pick up where you left off.'}
        </p>
      </div>
      <ButtonLink href={ONBOARDING_HREF[role]} className="shrink-0">
        {unfinished ? 'Finish setup' : 'Start setup'}
      </ButtonLink>
    </section>
  );
}
