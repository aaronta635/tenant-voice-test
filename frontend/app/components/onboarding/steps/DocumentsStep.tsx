'use client';

import DocumentsPanel from '@/app/components/documents/DocumentsPanel';
import { useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';

/**
 * The member's private documents (reference step 15), in the documents panel
 * the profile pages use: each file saves as it uploads, so moving on has
 * nothing more to save.
 */
export default function DocumentsStep({ profile, handle }: StepProps) {
  useStepAnswers(handle, () => null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-body">
        Each document saves to your account as soon as it uploads, and you can replace it later from your profile.
      </p>
      <DocumentsPanel legacyPicks={profile.tenant ? 'tenant' : 'landlord'} />
    </div>
  );
}
