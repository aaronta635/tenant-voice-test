'use client';

import { useState } from 'react';
import TextAreaField from '@/app/components/onboarding/TextAreaField';
import { useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import { NOTE } from '@/app/components/onboarding/styles';
import { textOrNull } from '@/app/lib/my-profile';

// The reference counts words and asks for at least 50.
const GOOD_LENGTH = 50;

const TIPS = {
  tenant: [
    'Your work or study',
    'Your lifestyle and daily routine',
    'How you care for a home',
    'How you like to keep in touch',
    'What you want from a tenancy, such as a long and quiet stay',
  ],
  landlord: [
    'The homes you rent out, and where',
    'How long you have rented them out',
    'How you handle repairs and maintenance',
    'How tenants reach you, and how soon you reply',
  ],
};

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * The about line of the member's public profile (reference step 12): a
 * tenant's about_me, a landlord's or agent's bio. Both are public.
 */
export default function AboutStep({ profile, handle }: StepProps) {
  const tenant = profile.tenant !== null;
  const saved = (tenant ? profile.tenant?.about_me : profile.landlord?.bio) ?? null;
  const [text, setText] = useState(saved ?? '');
  const words = wordCount(text);

  useStepAnswers(handle, () => {
    const value = textOrNull(text);
    if (value === saved) return null;
    return { patch: tenant ? { tenant: { about_me: value } } : { landlord: { bio: value } } };
  });

  return (
    <div className="space-y-5">
      <div className={NOTE}>
        <p className="font-semibold text-text-dark">Ideas to include</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {(tenant ? TIPS.tenant : TIPS.landlord).map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
      </div>
      <TextAreaField
        id="onboarding-about"
        label={tenant ? 'About you' : 'About you and your rentals'}
        hint="Shown on your public profile, so leave out contact details."
        rows={6}
        maxLength={tenant ? 2000 : 1000}
        value={text}
        onChange={setText}
        footer={(
          <>
            {words} {words === 1 ? 'word' : 'words'}
            {words > 0 && words < GOOD_LENGTH ? (
              <span className="text-warning"> · Aim for {GOOD_LENGTH} words or more for the best impression.</span>
            ) : null}
          </>
        )}
      />
    </div>
  );
}
