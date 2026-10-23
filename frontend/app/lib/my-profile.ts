// The signed-in member's own profile (R14): the account fields, plus what
// only they may read: their notification and privacy settings, the details
// of their role, and a tenant's profile completion, which the server works
// out (backend/app/schemas/profiles.py, MyProfileOut). GET /profiles/me is
// the only response that holds them.
//
// A save is a patch at every level: a key left out keeps its value and a
// null clears it. Lists are replaced whole.

import { apiFetch, type Profile } from './api';

// The settings are shared with the mobile app, which keeps them in
// users.metadata.mobile (backend/app/services/member_settings.py): a switch
// set in either app holds in both.

/** The web's kinds of notice, each with a switch of its name. */
export type NotificationKind = 'message' | 'review' | 'booking' | 'application' | 'property' | 'account';
export const NOTIFICATION_KINDS: NotificationKind[] = [
  'message', 'application', 'booking', 'review', 'property', 'account',
];
/**
 * The switches the mobile app shares: push_enabled off stops every notice but
 * account ones; matches, repairs and profile_updates are its categories (the
 * web's property is now listing and complaint updates only).
 */
export type SharedNotificationSwitch = 'push_enabled' | 'matches' | 'repairs' | 'profile_updates';
export type NotificationSwitch = NotificationKind | SharedNotificationSwitch;
export type NotificationPreferences = Record<NotificationKind, boolean>
  & Partial<Record<SharedNotificationSwitch, boolean>>;

/** The privacy switches; the ones after share_score are the mobile app's, which it acts on. */
export type PrivacySwitch =
  | 'public_profile' | 'share_score' | 'discoverable' | 'show_contact' | 'show_availability' | 'allow_messages';
export type PrivacySettings = { public_profile: boolean; share_score: boolean }
  & Partial<Record<Exclude<PrivacySwitch, 'public_profile' | 'share_score'>, boolean>>;
/** What a switch the response leaves out means: on, but contact details stay hidden. */
export const PRIVACY_DEFAULTS: Record<PrivacySwitch, boolean> = {
  public_profile: true, share_score: true, discoverable: true, show_contact: false, show_availability: true,
  allow_messages: true,
};
export type ProfileSettings = {
  notification_preferences: NotificationPreferences;
  privacy: PrivacySettings;
};

export type EmploymentType =
  | 'full_time' | 'part_time' | 'self_employed' | 'contractor' | 'student' | 'retired' | 'unemployed'
  | 'working_holiday' | 'other';
export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'full_time', label: 'Working full-time' },
  { value: 'part_time', label: 'Working part-time' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'contractor', label: 'Contractor or freelancer' },
  { value: 'student', label: 'Student' },
  { value: 'retired', label: 'Retired' },
  { value: 'unemployed', label: 'Not working' },
  { value: 'working_holiday', label: 'Working holiday' },
  { value: 'other', label: 'Other' },
];
/** Types that come with an employer, or for the self-employed a business. */
export const WORKING_TYPES: EmploymentType[] = [
  'full_time', 'part_time', 'self_employed', 'contractor', 'working_holiday',
];

export type PropertyType = 'apartment' | 'house' | 'studio' | 'townhouse' | 'unit' | 'duplex';
export const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: 'apartment', label: 'Apartment' },
  { value: 'house', label: 'House' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'unit', label: 'Unit' },
  { value: 'studio', label: 'Studio' },
  { value: 'duplex', label: 'Duplex' },
];

export type QualityTag =
  | 'reliable_rent' | 'clear_communication' | 'cares_for_property' | 'respectful_neighbour' | 'long_term_stay';
export const TENANT_QUALITIES: { value: QualityTag; label: string }[] = [
  { value: 'reliable_rent', label: 'Reliable rent payments' },
  { value: 'clear_communication', label: 'Clear communication' },
  { value: 'cares_for_property', label: 'Cares for the property' },
  { value: 'respectful_neighbour', label: 'Respectful of neighbours' },
  { value: 'long_term_stay', label: 'Looking for a long-term stay' },
];

export type BondReturned = 'yes' | 'no' | 'partial' | 'pending';
export const BOND_ANSWERS: { value: BondReturned; label: string }[] = [
  { value: 'yes', label: 'Returned in full' },
  { value: 'partial', label: 'Partly returned' },
  { value: 'no', label: 'Not returned' },
  { value: 'pending', label: 'Still pending' },
];

export type Employment = {
  types: EmploymentType[];
  employer: string | null;
  job_title: string | null;
  annual_income: number | null;
  notes: string | null;
};
export type HouseholdMember = { name: string; age: number | null; relationship: string | null };
export type Household = { members: HouseholdMember[]; pets: string | null };
export type EmergencyContact = {
  name: string | null;
  relationship: string | null;
  phone: string | null;
  email: string | null;
};
export type RentalHistoryEntry = {
  id: string;
  address: string;
  suburb: string | null;
  state: string | null;
  /** YYYY-MM-DD */
  start_date: string | null;
  end_date: string | null;
  current: boolean;
  weekly_rent: number | null;
  landlord_name: string | null;
  landlord_contact: string | null;
  reason_for_leaving: string | null;
  bond_returned: BondReturned | null;
};
export type RentalPreferences = {
  property_types: PropertyType[];
  bedrooms_min: number | null;
  bathrooms_min: number | null;
  parking_min: number | null;
  notes: string | null;
};
export type TenantQualities = { tags: QualityTag[]; notes: string | null };

export type TenantDetails = {
  /** Public: the about line of the tenant's public profile. */
  about_me: string | null;
  /** Public, in dollars a week. */
  budget_min: number | null;
  budget_max: number | null;
  /** Public. */
  preferred_locations: string[];
  /** YYYY-MM-DD; only its month is public. */
  move_in_date: string | null;
  household_size: number | null;
  has_pets: boolean;
  employment: Employment;
  household: Household;
  emergency_contact: EmergencyContact;
  rental_history: RentalHistoryEntry[];
  rental_preferences: RentalPreferences;
  qualities: TenantQualities;
};

export type LandlordDetails = {
  agency_name: string | null;
  license_number: string | null;
  portfolio_size: number | null;
  /** Public: the about line of the landlord's public profile. */
  bio: string | null;
};

export type CompletionStatus = 'started' | 'almost_ready' | 'ready';
export type CompletionItem = {
  key: string;
  label: string;
  description: string;
  kind: 'required' | 'booster';
  done: boolean;
  /** False while the feature the row needs is not built yet. */
  available: boolean;
};
export type ProfileCompletion = {
  score: number;
  status: CompletionStatus;
  required_done: number;
  required_total: number;
  boosters_done: number;
  boosters_total: number;
  items: CompletionItem[];
  /** The keys of the rows still to do, required first. */
  missing: string[];
};

export type MyProfile = Profile & {
  settings: ProfileSettings;
  /**
   * The fields shown from the mobile app's details where the web holds none
   * of its own ("phone", "tenant.emergency_contact", ...). Saving a form
   * keeps them on the website.
   */
  from_mobile?: string[];
  /** Null unless the account is a tenant's. */
  tenant: TenantDetails | null;
  /** Null unless the account is a landlord's or an agent's. */
  landlord: LandlordDetails | null;
  completion: ProfileCompletion | null;
};

export type RentalHistoryInput = Omit<RentalHistoryEntry, 'id'> & { id?: string };
export type TenantDetailsUpdate = Partial<Omit<TenantDetails,
  'employment' | 'household' | 'emergency_contact' | 'rental_history' | 'rental_preferences' | 'qualities'>> & {
  employment?: Partial<Employment> | null;
  household?: Partial<Household> | null;
  emergency_contact?: Partial<EmergencyContact> | null;
  rental_history?: RentalHistoryInput[];
  rental_preferences?: Partial<RentalPreferences> | null;
  qualities?: Partial<TenantQualities> | null;
};
export type MyProfileUpdate = {
  full_name?: string;
  avatar_url?: string | null;
  phone?: string | null;
  location?: string | null;
  state?: string | null;
  postcode?: string | null;
  tenant?: TenantDetailsUpdate;
  landlord?: Partial<LandlordDetails>;
  settings?: {
    notification_preferences?: Partial<Record<NotificationSwitch, boolean>>;
    privacy?: Partial<Record<PrivacySwitch, boolean>>;
  };
};

export function getMyProfile(): Promise<MyProfile> {
  return apiFetch<MyProfile>('/profiles/me');
}

export function updateMyProfile(patch: MyProfileUpdate): Promise<MyProfile> {
  return apiFetch<MyProfile>('/profiles/me', { method: 'PATCH', body: patch });
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------
export const COMPLETION_STATUS_LABELS: Record<CompletionStatus, string> = {
  started: 'Profile started',
  almost_ready: 'Almost ready',
  ready: 'Ready to share',
};

/** Where a tenant completes each completion row; a row with no page here has none yet. */
export const COMPLETION_HREFS: Record<string, string> = {
  personal_details: '/tenant/personal-information',
  employment: '/tenant/financial-information',
  primary_id: '/tenant/id-verification',
  secondary_id: '/tenant/id-verification',
  proof_of_address: '/tenant/id-verification',
  rental_history: '/tenant/address-history',
  property_preferences: '/tenant/rental-preferences',
  availability: '/tenant/rental-preferences',
  income_documents: '/tenant/id-verification',
  employment_contract: '/tenant/id-verification',
  payslips: '/tenant/id-verification',
  bank_statements: '/tenant/id-verification',
  property_review: '/tenant/write-review',
};

/**
 * The completion score the server worked out, as GET /profiles/me returns it
 * (also when the caller typed the response as a plain Profile); 0 until it
 * loads, and for accounts that have none.
 */
export function completionScore(profile: Profile | null | undefined): number {
  return (profile as Partial<MyProfile> | null | undefined)?.completion?.score ?? 0;
}

/** Whether a tenant has saved any detail of their own beyond the account fields. */
export function hasTenantDetails(tenant: TenantDetails | null | undefined): boolean {
  if (!tenant) return false;
  const { employment, household, emergency_contact: contact, rental_preferences: preferences, qualities } = tenant;
  return Boolean(
    tenant.about_me || tenant.budget_min != null || tenant.budget_max != null || tenant.preferred_locations.length
    || tenant.move_in_date || tenant.household_size != null || tenant.has_pets
    || employment.types.length || employment.employer || employment.job_title || employment.annual_income != null
    || employment.notes || household.members.length || household.pets
    || contact.name || contact.relationship || contact.phone || contact.email
    || tenant.rental_history.length
    || preferences.property_types.length || preferences.bedrooms_min != null || preferences.bathrooms_min != null
    || preferences.parking_min != null || preferences.notes
    || qualities.tags.length || qualities.notes,
  );
}

// ---------------------------------------------------------------------------
// Form values
// ---------------------------------------------------------------------------
/** A text box's value as the API takes it: trimmed, and null when empty. */
export function textOrNull(value: string): string | null {
  const text = value.trim();
  return text ? text : null;
}

/** A number box's value: null when empty, NaN when it is not a number. */
export function numberOrNull(value: string): number | null {
  const text = value.trim();
  return text ? Number(text) : null;
}

/** A stored number for a number box. */
export function numberText(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

/**
 * The fields of `next` whose values differ from `stored`: all a save needs to
 * send. A form that sends only these never sends back a value stored before
 * today's checks, or by another app, so such a value cannot block a save.
 */
export function changedFields<T extends object>(stored: T, next: T): Partial<T> {
  const same = (a: unknown, b: unknown) =>
    a !== null && b !== null && typeof a === 'object' && typeof b === 'object'
      ? JSON.stringify(a) === JSON.stringify(b)
      : Object.is(a, b);
  const changes: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (!same(stored[key], next[key])) changes[key] = next[key];
  }
  return changes;
}

/** Comma-separated suburbs as a list, without blanks or repeats. */
export function placeList(value: string): string[] {
  const seen = new Set<string>();
  return value.split(',').map((place) => place.trim()).filter((place) => {
    const key = place.toLowerCase();
    if (!place || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Mirror the server's checks (backend/app/schemas/profiles.py), so most
// mistakes are caught before a save; the server still checks everything.
export function isPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '').length;
  return /^\+?[0-9 ()-]+$/.test(value.trim()) && digits >= 6 && digits <= 15;
}

export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

export function isPostcode(value: string): boolean {
  return /^\d{4}$/.test(value.trim());
}

/** Today in Sydney as YYYY-MM-DD, the day the server checks dates against. */
export function sydneyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(now);
}

/** YYYY-MM-DD `days` after a YYYY-MM-DD date. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The move-in dates the server takes: from a year ago to two years ahead. */
export function moveInRange(now: Date = new Date()): { min: string; max: string } {
  const today = sydneyToday(now);
  return { min: addDays(today, -365), max: addDays(today, 2 * 365) };
}
