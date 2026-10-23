import type { ReactNode } from 'react';
import BrandLogo from '@/app/components/BrandLogo';
import DemoLabel from '@/app/components/demo/DemoLabel';
import { isDemoAccount } from '@/app/lib/demo';

/** Where the open step sits among the wizard's steps. */
export type StepPlace = { label: string; position: number; total: number };

type Props = {
  /** The signed-in account: a seeded one gets the sample-account notice its workspace shows. */
  accountId?: string | null;
  /** The top bar's exit, such as Save & close. */
  action?: ReactNode;
  /** The progress strip; none on the welcome step. */
  place?: StepPlace | null;
  children: ReactNode;
};

/**
 * The onboarding page around a step, laid out as the reference wizard is
 * (output/references/onboarding/onboarding.md): a top bar with the logo and
 * the way out, the step's place, then one centred column. It stands outside
 * the workspace shell, so its own exit is the only one that saves.
 */
export default function OnboardingFrame({ accountId, action, place, children }: Props) {
  return (
    <div className="min-h-screen w-full bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-white">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-3 px-4 sm:px-6">
          <BrandLogo href="" size="sm" />
          {action}
        </div>
      </header>
      {place ? (
        <div className="border-b border-border bg-white">
          <div className="mx-auto w-full max-w-2xl px-4 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-3 text-xs text-text-body">
              <span className="min-w-0 truncate">{place.label}</span>
              <span className="shrink-0">
                Step {place.position} of {place.total}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={0}
              aria-valuemax={place.total}
              aria-valuenow={place.position}
              aria-valuetext={`Step ${place.position} of ${place.total}: ${place.label}`}
              className="mt-2 h-2 rounded-full border border-control-border bg-surface"
            >
              <div
                className="h-full rounded-full bg-primary forced-colors:bg-[Highlight]"
                style={{ width: `${Math.round((place.position / place.total) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        {isDemoAccount(accountId) ? (
          <DemoLabel
            variant="notice"
            className="mb-6"
            reason="Sample account: the people, homes, bookings and messages here are fictional, for a TenantVoice walkthrough."
          />
        ) : null}
        {children}
      </main>
    </div>
  );
}
