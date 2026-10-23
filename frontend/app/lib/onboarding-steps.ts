// The steps of the tenant and landlord onboarding wizards, in order: the
// names the server keeps as the step to resume at (docs/shared-db.md,
// "Onboarding"), and the words each step shows. The welcome step comes
// first and has no entry here. components/onboarding gives each its form.

import type { OnboardingRole } from './onboarding';

export type StepInfo = {
  key: string;
  /** The step's name in the progress strip and in "Finish setup". */
  label: string;
  title: string;
  description: string;
};

export const TENANT_STEPS: StepInfo[] = [
  { key: 'personal', label: 'Personal details', title: 'About you', description: 'Tell owners who you are. Only your name is needed to continue.' },
  { key: 'household', label: 'Household', title: 'Who is moving in', description: 'Add the people who will live with you, and any pets.' },
  { key: 'locations', label: 'Preferred suburbs', title: 'Where are you looking to live?', description: 'Add the suburbs you would like to live in. Three or four give the best matches.' },
  { key: 'budget', label: 'Rent and timing', title: 'Rent and timing', description: 'Help owners understand your budget and when you need to move.' },
  { key: 'property', label: 'Property preferences', title: 'Property preferences', description: 'Set what you are looking for. Every field is optional.' },
  { key: 'employment', label: 'Employment', title: 'Employment', description: 'Choose all that apply. This helps owners understand your rental capacity.' },
  { key: 'qualities', label: 'Tenant qualities', title: 'How you rent', description: 'Pick what owners can count on when they rent to you.' },
  { key: 'about', label: 'Introduction', title: 'Introduce yourself', description: 'Tell owners and agents what makes you a great tenant.' },
  { key: 'history', label: 'Rental history', title: 'Rental history', description: 'Add the homes you have rented in the past three years. A full history builds trust with owners.' },
  { key: 'documents', label: 'Verification documents', title: 'Verification documents', description: 'Verified documents build trust and earn the verified badge on your profile.' },
  { key: 'emergency', label: 'Emergency contact', title: 'Emergency contact', description: 'Optional, and strictly private: owners never see it.' },
  { key: 'preview', label: 'Preview', title: 'Preview your profile', description: 'This is how your profile appears to owners and other members.' },
  { key: 'publish', label: 'Share your profile', title: 'Share your profile', description: 'Choose whether members can find your profile.' },
];

export const LANDLORD_STEPS: StepInfo[] = [
  { key: 'personal', label: 'Personal details', title: 'About you', description: 'Tell tenants who they would rent from. Only your name is needed to continue.' },
  { key: 'business', label: 'Rental business', title: 'Your rental business', description: 'Your business name shows on your public profile. Your licence number stays private.' },
  { key: 'about', label: 'Introduction', title: 'Introduce yourself', description: 'A few lines tenants read on your public profile.' },
  { key: 'documents', label: 'Verification documents', title: 'Verification documents', description: 'Verify your identity and your right to rent out your properties to earn the verified badge.' },
  { key: 'preview', label: 'Preview', title: 'Preview your profile', description: 'This is how your profile appears to tenants and other members.' },
  { key: 'publish', label: 'Share your profile', title: 'Share your profile', description: 'Choose whether members can find your profile.' },
];

export const ONBOARDING_STEPS: Record<OnboardingRole, StepInfo[]> = { tenant: TENANT_STEPS, landlord: LANDLORD_STEPS };

/** A saved step's name for people; null for the welcome step and for names the wizard no longer has. */
export function stepLabel(role: OnboardingRole, key: string | null): string | null {
  return ONBOARDING_STEPS[role].find((step) => step.key === key)?.label ?? null;
}
