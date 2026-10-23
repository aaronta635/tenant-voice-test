// A landlord's setup checklist (R19): what their profile and verification
// still need, read from what the server sends. The server works out a
// completion score for renter profiles only (backend
// services/profile_completion.py), so a landlord gets these items without a
// score: their own fields from GET /profiles/me, and each verification
// requirement with the status GET /me/documents gives it.

import type { MyProfile } from './my-profile';
import type { DocumentChecklist, RequirementStatus } from './profile-documents';

export type SetupItem = {
  key: string;
  label: string;
  description: string;
  kind: 'required' | 'booster';
  /** The landlord's own details, or a verification requirement. */
  group: 'profile' | 'verification';
  done: boolean;
  /** A document requirement's status, as the documents checklist reports it. */
  status?: RequirementStatus;
  /** Where to fill it in. */
  href: string;
};

const EDIT = '/owner/profile/edit';
const VERIFICATION = '/owner/profile/verification';
const REQUIREMENT_HELP: Record<string, string> = {
  photo_id: 'A passport, driver licence or photo ID card.',
  property_authority: 'A rates notice, title search, or an authority to manage the property.',
};

const filled = (value: string | null | undefined) => Boolean(value?.trim());

/**
 * The items, required first. A document requirement counts once a document
 * for it is uploaded, until an admin rejects it, as a tenant's completion
 * counts documents.
 */
export function landlordSetup(profile: MyProfile, documents: DocumentChecklist): SetupItem[] {
  const landlord = profile.landlord;
  return [
    {
      key: 'personal_details', label: 'Personal details', description: 'Your full name and a phone number.',
      kind: 'required', group: 'profile', done: filled(profile.full_name) && filled(profile.phone), href: EDIT,
    },
    ...documents.requirements.map((requirement): SetupItem => ({
      key: requirement.key,
      label: requirement.label,
      description: REQUIREMENT_HELP[requirement.key] ?? 'A document a TenantVoice admin checks.',
      kind: 'required',
      group: 'verification',
      done: requirement.status === 'pending' || requirement.status === 'verified',
      status: requirement.status,
      href: VERIFICATION,
    })),
    {
      key: 'about', label: 'About you', description: 'A few lines tenants read on your public profile.',
      kind: 'booster', group: 'profile', done: filled(landlord?.bio), href: EDIT,
    },
    {
      key: 'business', label: 'Your rental business',
      description: 'Your business name, licence number or how many properties you rent out.',
      kind: 'booster',
      group: 'profile',
      done: filled(landlord?.agency_name) || filled(landlord?.license_number) || landlord?.portfolio_size != null,
      href: EDIT,
    },
    {
      key: 'suburb', label: 'Your suburb', description: 'The suburb and state your public profile shows.',
      kind: 'booster', group: 'profile', done: filled(profile.location), href: EDIT,
    },
  ];
}
