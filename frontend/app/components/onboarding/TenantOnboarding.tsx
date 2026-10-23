'use client';

import type { ComponentType } from 'react';
import OnboardingWizard, { type OnboardingStep } from '@/app/components/onboarding/OnboardingWizard';
import type { StepProps } from '@/app/components/onboarding/step-types';
import AboutStep from '@/app/components/onboarding/steps/AboutStep';
import BudgetStep from '@/app/components/onboarding/steps/BudgetStep';
import DocumentsStep from '@/app/components/onboarding/steps/DocumentsStep';
import EmergencyStep from '@/app/components/onboarding/steps/EmergencyStep';
import EmploymentStep from '@/app/components/onboarding/steps/EmploymentStep';
import HistoryStep from '@/app/components/onboarding/steps/HistoryStep';
import HouseholdStep from '@/app/components/onboarding/steps/HouseholdStep';
import LocationsStep from '@/app/components/onboarding/steps/LocationsStep';
import PersonalStep from '@/app/components/onboarding/steps/PersonalStep';
import PreviewStep from '@/app/components/onboarding/steps/PreviewStep';
import PropertyStep from '@/app/components/onboarding/steps/PropertyStep';
import PublishStep from '@/app/components/onboarding/steps/PublishStep';
import QualitiesStep from '@/app/components/onboarding/steps/QualitiesStep';
import type { WelcomeCopy } from '@/app/components/onboarding/WelcomeCard';
import { TENANT_STEPS } from '@/app/lib/onboarding-steps';

const FORMS: Record<string, ComponentType<StepProps>> = {
  personal: PersonalStep,
  household: HouseholdStep,
  locations: LocationsStep,
  budget: BudgetStep,
  property: PropertyStep,
  employment: EmploymentStep,
  qualities: QualitiesStep,
  about: AboutStep,
  history: HistoryStep,
  documents: DocumentsStep,
  emergency: EmergencyStep,
  preview: PreviewStep,
  publish: PublishStep,
};

export const TENANT_WIZARD: OnboardingStep[] = TENANT_STEPS.map((step) => ({ ...step, Step: FORMS[step.key] }));

const WELCOME: WelcomeCopy = {
  title: 'Create your renter profile',
  description:
    'Build the profile owners and agents see when they look you up, with your rental record and verified ID, and stand out from the crowd.',
  highlights: [
    { icon: 'shield', title: 'Verified identity', detail: 'Your ID, checked by our team' },
    { icon: 'home', title: 'Rental track record', detail: 'Your past homes and how you rent' },
    { icon: 'lock', title: 'You choose what shows', detail: 'Documents and contact details stay private' },
  ],
  duration: 'Takes about 10 minutes.',
};

/** A tenant's onboarding, after the reference's renter profile wizard (/onboarding). */
export default function TenantOnboarding() {
  return <OnboardingWizard role="tenant" welcome={WELCOME} steps={TENANT_WIZARD} />;
}
