'use client';

import { useState } from 'react';
import ChoiceTiles from '@/app/components/onboarding/ChoiceTiles';
import TextAreaField from '@/app/components/onboarding/TextAreaField';
import { patchOf, useStepAnswers, type StepProps } from '@/app/components/onboarding/step-types';
import {
  changedFields,
  TENANT_QUALITIES,
  textOrNull,
  type QualityTag,
  type TenantDetails,
} from '@/app/lib/my-profile';

/**
 * What owners can count on (the reference's lifestyle step, as the qualities
 * the profile keeps): private until profiles can be shared with an owner.
 */
export default function QualitiesStep({ profile, handle }: StepProps) {
  const tenant = profile.tenant as TenantDetails;
  const [tags, setTags] = useState(tenant.qualities.tags);
  const [notes, setNotes] = useState(tenant.qualities.notes ?? '');

  useStepAnswers(handle, () => {
    const changes = changedFields(
      { tags: tenant.qualities.tags, notes: tenant.qualities.notes },
      { tags, notes: textOrNull(notes) },
    );
    return patchOf({ tenant: { qualities: changes } }, changes);
  });

  return (
    <div className="space-y-6">
      <ChoiceTiles<QualityTag>
        legend="Your strengths as a tenant"
        hint="Only you can see these until you share your profile with an owner."
        options={TENANT_QUALITIES}
        value={tags}
        onChange={setTags}
      />
      <TextAreaField
        id="onboarding-quality-notes"
        label="Anything else owners should know"
        rows={3}
        maxLength={1000}
        value={notes}
        onChange={setNotes}
      />
    </div>
  );
}
