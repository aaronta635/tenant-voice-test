// What older builds kept in this browser's localStorage (tv_tenant_profile_extras)
// before profile details were saved to the account (lib/my-profile.ts).
// legacyProfilePatch() turns what is left into one save, which the tenant
// profile screens offer once (components/tenant/LegacyProfileOffer); either
// answer clears it. Nothing ties these details to an account, and anyone may
// have used this browser, so the private ones (an emergency contact,
// employment and income, past addresses) are only named, never saved. The
// documents panel takes the old ID screens' file names (lib/legacy-document-picks).

import { formatDate } from './format';
import {
  isPhone,
  moveInRange,
  PROPERTY_TYPES,
  sydneyToday,
  TENANT_QUALITIES,
  type MyProfileUpdate,
  type NotificationSwitch,
  type PropertyType,
  type QualityTag,
  type RentalHistoryInput,
  type TenantDetailsUpdate,
} from './my-profile';

const KEY = 'tv_tenant_profile_extras';
const DOCUMENT_FIELDS = ['passport_name', 'passport_uploaded_at', 'id_document_name', 'id_uploaded_at'] as const;

export type TenantDocumentExtras = Record<(typeof DOCUMENT_FIELDS)[number], string>;
const EMPTY_DOCUMENTS: TenantDocumentExtras = {
  passport_name: '',
  passport_uploaded_at: '',
  id_document_name: '',
  id_uploaded_at: '',
};

/** The legacy fields this module moves to the account, as an older build stored them. */
type LegacyExtras = {
  emergency_name?: unknown;
  emergency_phone?: unknown;
  employment?: unknown;
  annual_income?: unknown;
  financial_notes?: unknown;
  budget_min?: unknown;
  budget_max?: unknown;
  preferred_suburb?: unknown;
  property_type?: unknown;
  move_in?: unknown;
  has_pets?: unknown;
  qualities?: unknown;
  quality_notes?: unknown;
  notify_applications?: unknown;
  notify_messages?: unknown;
  notify_matches?: unknown;
  privacy_hide_profile?: unknown;
  privacy_share_score?: unknown;
  addresses?: unknown;
};

function stored(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function store(value: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  if (Object.keys(value).length === 0) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(value));
}

/** The ID screens' note of the file chosen in this browser. */
export function getTenantExtras(): TenantDocumentExtras {
  const values = stored();
  const documents = { ...EMPTY_DOCUMENTS };
  for (const field of DOCUMENT_FIELDS) {
    if (typeof values[field] === 'string') documents[field] = values[field];
  }
  return documents;
}

export function saveTenantExtras(patch: Partial<TenantDocumentExtras>): TenantDocumentExtras {
  // Anything else stored here waits for the offer to move it, so it stays.
  store({ ...stored(), ...patch });
  return getTenantExtras();
}

/** Forget the details an older build left here, once moved or declined; the ID screens' notes stay. */
export function clearLegacyProfile() {
  const values = stored();
  const kept = Object.fromEntries(
    DOCUMENT_FIELDS
      .filter((field) => typeof values[field] === 'string' && values[field])
      .map((field) => [field, values[field]]),
  );
  store(kept);
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function amount(value: unknown, max: number): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
}

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

/** A month box's YYYY-MM as the first of that month, if it is a past or present month. */
function monthStart(value: unknown, today: string): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return null;
  const day = `${value}-01`;
  return isDay(day) && day >= '1950-01-01' && day <= today ? day : null;
}

function addresses(value: unknown, today: string): RentalHistoryInput[] {
  if (!Array.isArray(value)) return [];
  const entries: RentalHistoryInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const legacy = item as Record<string, unknown>;
    const address = text(legacy.address, 200);
    if (!address) continue;
    const start = monthStart(legacy.from, today);
    const end = monthStart(legacy.to, today);
    entries.push({
      address,
      suburb: text(legacy.suburb, 80),
      state: null,
      start_date: start,
      end_date: end && (!start || end >= start) ? end : null,
      current: false,
      weekly_rent: null,
      landlord_name: null,
      landlord_contact: null,
      reason_for_leaving: null,
      bond_returned: null,
    });
  }
  return entries.slice(0, 20);
}

function propertyTypes(value: string | null): { types: PropertyType[]; rest: string | null } {
  if (!value) return { types: [], rest: null };
  const words = value.toLowerCase().split(/[^a-z]+/);
  const types = PROPERTY_TYPES.map((type) => type.value).filter((type) => words.includes(type));
  return { types, rest: types.length ? null : value };
}

/**
 * The private details an older build left in this browser, named for the
 * offer: an emergency contact, employment and income, and past addresses.
 * They are never saved from it, since nothing shows they belong to the
 * account signed in now; a person whose they are enters them again.
 */
export function legacyPrivateDetails(now: Date = new Date()): string[] {
  const legacy = stored() as LegacyExtras;
  const contactName = text(legacy.emergency_name, 120);
  const contactPhone = text(legacy.emergency_phone, 30);
  const employment = text(legacy.employment, 1000) || text(legacy.financial_notes, 1000)
    || amount(legacy.annual_income, 10_000_000) != null;
  const history = addresses(legacy.addresses, sydneyToday(now)).length;
  return [
    contactName && contactPhone && isPhone(contactPhone) ? 'an emergency contact' : null,
    employment ? 'employment and income' : null,
    history ? `${history} previous ${history === 1 ? 'address' : 'addresses'}` : null,
  ].filter((item): item is string => !!item);
}

/**
 * The details an older build left in this browser that may be saved to the
 * account, as one profile save; null when there are none. The private ones
 * are left out (legacyPrivateDetails), and so are values the account would
 * refuse (a date out of range), so the save goes through.
 */
export function legacyProfilePatch(now: Date = new Date()): MyProfileUpdate | null {
  const legacy = stored() as LegacyExtras;
  const tenant: TenantDetailsUpdate = {};

  const low = amount(legacy.budget_min, 20_000);
  const high = amount(legacy.budget_max, 20_000);
  if (high != null) tenant.budget_max = high;
  if (low != null && (high == null || low <= high)) tenant.budget_min = low;
  const suburb = text(legacy.preferred_suburb, 80);
  if (suburb) tenant.preferred_locations = [suburb];
  const { types, rest } = propertyTypes(text(legacy.property_type, 200));
  if (types.length || rest) tenant.rental_preferences = types.length ? { property_types: types } : { notes: rest };
  const { min, max } = moveInRange(now);
  if (typeof legacy.move_in === 'string' && isDay(legacy.move_in) && legacy.move_in >= min && legacy.move_in <= max) {
    tenant.move_in_date = legacy.move_in;
  }
  if (legacy.has_pets === true) tenant.has_pets = true;

  const labels = new Map(TENANT_QUALITIES.map((quality) => [quality.label, quality.value]));
  const tags = Array.isArray(legacy.qualities)
    ? [...new Set(legacy.qualities.map((label) => labels.get(String(label))).filter((tag): tag is QualityTag => !!tag))]
    : [];
  const qualityNotes = text(legacy.quality_notes, 1000);
  if (tags.length || qualityNotes) {
    tenant.qualities = { ...(tags.length ? { tags } : {}), ...(qualityNotes ? { notes: qualityNotes } : {}) };
  }

  // Switches were on by default, so only one turned off has anything to move.
  const off = (value: unknown) => value === false;
  const notifications: Partial<Record<NotificationSwitch, boolean>> = {};
  if (off(legacy.notify_applications)) notifications.application = false;
  if (off(legacy.notify_messages)) notifications.message = false;
  // Match alerts have a switch of their own, shared with the mobile app.
  if (off(legacy.notify_matches)) notifications.matches = false;
  const privacy = {
    ...(legacy.privacy_hide_profile === true ? { public_profile: false } : {}),
    ...(off(legacy.privacy_share_score) ? { share_score: false } : {}),
  };

  const patch: MyProfileUpdate = {};
  if (Object.keys(tenant).length) patch.tenant = tenant;
  if (Object.keys(notifications).length || Object.keys(privacy).length) {
    patch.settings = {
      ...(Object.keys(notifications).length ? { notification_preferences: notifications } : {}),
      ...(Object.keys(privacy).length ? { privacy } : {}),
    };
  }
  return Object.keys(patch).length ? patch : null;
}

function budget(low: number | null | undefined, high: number | null | undefined): string | null {
  if (low != null && high != null) return `$${low} to $${high} a week`;
  if (high != null) return `up to $${high} a week`;
  return low != null ? `from $${low} a week` : null;
}

/** What a legacy save holds, in words with its values, so a person can tell whether it is theirs. */
export function legacyProfileSummary(patch: MyProfileUpdate): string[] {
  const tenant = patch.tenant ?? {};
  const types = tenant.rental_preferences?.property_types ?? [];
  const preferences = [
    budget(tenant.budget_min, tenant.budget_max),
    tenant.preferred_locations?.join(', '),
    types.length ? types.map((type) => PROPERTY_TYPES.find((item) => item.value === type)?.label.toLowerCase() ?? type).join(' or ') : null,
    tenant.rental_preferences?.notes,
    tenant.move_in_date ? `moving in ${formatDate(tenant.move_in_date)}` : null,
    tenant.has_pets ? 'with pets' : null,
  ].filter((item): item is string => !!item);
  const qualities = [
    ...(tenant.qualities?.tags ?? []).map((tag) => TENANT_QUALITIES.find((item) => item.value === tag)?.label ?? tag),
    tenant.qualities?.notes ? 'and a note' : null,
  ].filter((item): item is string => !!item);
  return [
    preferences.length ? `Rental preferences: ${preferences.join(', ')}` : null,
    qualities.length ? `Tenant qualities: ${qualities.join(', ')}` : null,
    patch.settings ? 'Notification and privacy choices' : null,
  ].filter((item): item is string => !!item);
}
