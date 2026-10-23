import { Suspense } from 'react';
import LandlordOnboarding from '@/app/components/onboarding/LandlordOnboarding';
import OnboardingFrame from '@/app/components/onboarding/OnboardingFrame';

export const metadata = { title: 'Set up your landlord profile' };

/**
 * A new landlord's first page (lib/auth-redirect registerLanding); it resumes
 * at the saved step. It sits outside the (owner) group, whose layout puts
 * every page in the workspace shell: the wizard has its own frame, as the
 * tenant one does.
 */
export default function LandlordOnboardingPage() {
  return (
    <Suspense
      fallback={(
        <OnboardingFrame>
          <p role="status" className="text-sm text-text-body">Loading your setup…</p>
        </OnboardingFrame>
      )}
    >
      <LandlordOnboarding />
    </Suspense>
  );
}
