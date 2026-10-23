'use client';

import { useState } from 'react';
import { useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import { NOTE } from '@/app/components/onboarding/styles';

const SHOWN = {
  tenant:
    'Anyone can find you in profile search. Your profile shows your first name and initial, the suburbs you want, '
    + 'your budget, move-in month, rating and about line. Your contact details, documents, household and rental '
    + 'history stay private.',
  landlord:
    'Anyone can find you in profile search. Your profile shows your name, business name, suburb, rating and about '
    + 'line. Your contact details, licence number and documents stay private.',
};
const HIDDEN = 'You stay out of profile search, and your public profile page is not shown.';

/**
 * Whether members can find the profile (reference step 19, "Publish your
 * profile"): users.metadata.privacy.public_profile, the switch the settings
 * page has too. Finishing this step finishes setup.
 */
export default function PublishStep({ profile, handle }: StepProps) {
  const saved = profile.settings.privacy.public_profile;
  const [shown, setShown] = useState(saved);
  const role = profile.tenant ? 'tenant' : 'landlord';

  useStepAnswers(handle, () => (shown === saved ? null : { patch: { settings: { privacy: { public_profile: shown } } } }));

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${shown ? 'border-primary-strong bg-surface' : 'border-control-border bg-white'}`}>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-text-dark">
          <input
            type="checkbox"
            checked={shown}
            aria-describedby="onboarding-visibility-detail"
            onChange={(event) => setShown(event.target.checked)}
            className="size-4 shrink-0 accent-primary-strong"
          />
          Show my profile in profile search
        </label>
        <p id="onboarding-visibility-detail" className="mt-1 pl-7 text-sm text-text-body">
          {shown ? SHOWN[role] : HIDDEN}
        </p>
      </div>
      <p className={NOTE}>You can change this at any time in your settings. Finish setup saves your choice.</p>
    </div>
  );
}
