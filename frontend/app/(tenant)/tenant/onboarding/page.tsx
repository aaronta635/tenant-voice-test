import { Suspense } from 'react';
import OnboardingFrame from '@/app/components/onboarding/OnboardingFrame';
import TenantOnboarding from '@/app/components/onboarding/TenantOnboarding';

export const metadata = { title: 'Set up your renter profile' };

/** A new tenant's first page (lib/auth-redirect registerLanding); it resumes at the saved step. */
export default function TenantOnboardingPage() {
  return (
    <Suspense
      fallback={(
        <OnboardingFrame>
          <p role="status" className="text-sm text-text-body">Loading your setup…</p>
        </OnboardingFrame>
      )}
    >
      <TenantOnboarding />
    </Suspense>
  );
}
