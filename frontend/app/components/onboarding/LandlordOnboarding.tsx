'use client';

import type { ComponentType } from 'react';
import OnboardingWizard, { type OnboardingStep } from '@/app/components/onboarding/OnboardingWizard';
import type { StepProps } from '@/app/components/onboarding/step-types';
import AboutStep from '@/app/components/onboarding/steps/AboutStep';
import BusinessStep from '@/app/components/onboarding/steps/BusinessStep';
import DocumentsStep from '@/app/components/onboarding/steps/DocumentsStep';
import PersonalStep from '@/app/components/onboarding/steps/PersonalStep';
import PreviewStep from '@/app/components/onboarding/steps/PreviewStep';
import PublishStep from '@/app/components/onboarding/steps/PublishStep';
import type { WelcomeCopy } from '@/app/components/onboarding/WelcomeCard';
import { LANDLORD_STEPS } from '@/app/lib/onboarding-steps';

const FORMS: Record<string, ComponentType<StepProps>> = {
  personal: PersonalStep,
  business: BusinessStep,
  about: AboutStep,
  documents: DocumentsStep,
  preview: PreviewStep,
  publish: PublishStep,
};

export const LANDLORD_WIZARD: OnboardingStep[] = LANDLORD_STEPS.map((step) => ({ ...step, Step: FORMS[step.key] }));

const WELCOME: WelcomeCopy = {
  title: 'Set up your landlord profile',
  description:
    'Tell tenants who they would rent from, and verify your identity and your properties to earn the verified badge.',
  highlights: [
    { icon: 'shield', title: 'Verified owner', detail: 'ID and ownership, checked by our team' },
    { icon: 'briefcase', title: 'Your rental business', detail: 'Your name, business and portfolio' },
    { icon: 'lock', title: 'You choose what shows', detail: 'Documents and your licence number stay private' },
  ],
  duration: 'Takes about 5 minutes.',
};

/** A landlord's or agent's onboarding, in the tenant wizard's frame with the landlord's own steps. */
export default function LandlordOnboarding() {
  return <OnboardingWizard role="landlord" welcome={WELCOME} steps={LANDLORD_WIZARD} />;
}
