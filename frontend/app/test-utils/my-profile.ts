// Own-profile responses (lib/my-profile.ts) for tests, and a stand-in for the
// server behind GET and PATCH /profiles/me that applies a patch as the
// backend does: objects merge key by key, a null clears, lists replace.
import type {
  MyProfile,
  MyProfileUpdate,
  ProfileCompletion,
  TenantDetails,
} from '@/app/lib/my-profile';

export function emptyTenant(): TenantDetails {
  return {
    about_me: null, budget_min: null, budget_max: null, preferred_locations: [], move_in_date: null,
    household_size: null, has_pets: false,
    employment: { types: [], employer: null, job_title: null, annual_income: null, notes: null },
    household: { members: [], pets: null },
    emergency_contact: { name: null, relationship: null, phone: null, email: null },
    rental_history: [],
    rental_preferences: { property_types: [], bedrooms_min: null, bathrooms_min: null, parking_min: null, notes: null },
    qualities: { tags: [], notes: null },
  };
}

export function noCompletion(): ProfileCompletion {
  return {
    score: 0, status: 'started', required_done: 0, required_total: 8, boosters_done: 0, boosters_total: 8,
    items: [], missing: [],
  };
}

/** A tenant's profile as GET /profiles/me sends it; landlord: true makes it a landlord's. */
export function myProfile(overrides: Partial<MyProfile> = {}, { landlord = false } = {}): MyProfile {
  return {
    id: 'c0000000-0000-4000-8000-000000000001',
    role: landlord ? 'landlord' : 'tenant',
    full_name: 'Mei Lin',
    email: 'mei@example.test',
    avatar_url: null,
    phone: '0400 000 000',
    location: 'Newtown',
    state: 'NSW',
    postcode: '2042',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    settings: {
      notification_preferences: {
        push_enabled: true, matches: true, repairs: true, profile_updates: true,
        message: true, review: true, booking: true, application: true, property: true, account: true,
      },
      privacy: {
        public_profile: true, discoverable: true, show_contact: false, show_availability: true, allow_messages: true,
        share_score: true,
      },
    },
    from_mobile: [],
    tenant: landlord ? null : emptyTenant(),
    landlord: landlord ? { agency_name: null, license_number: null, portfolio_size: null, bio: null } : null,
    completion: landlord ? null : noCompletion(),
    ...overrides,
  };
}

function merged<T>(stored: T, changes: object | null): T {
  if (changes === null) return stored;
  const result: Record<string, unknown> = { ...(stored as Record<string, unknown>) };
  for (const [key, value] of Object.entries(changes)) {
    const current = result[key];
    result[key] = value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object'
      ? merged(current, value)
      : value;
  }
  return result as T;
}

/** A server holding one profile; save() applies a patch to it and answers with the result. */
export function profileServer(profile: MyProfile) {
  let stored = structuredClone(profile);
  let ids = 0;
  return {
    get profile() {
      return structuredClone(stored);
    },
    read: async () => structuredClone(stored),
    save: async (patch: MyProfileUpdate) => {
      const { tenant, landlord, settings, ...fields } = structuredClone(patch);
      stored = { ...stored, ...fields };
      if (tenant && stored.tenant) {
        const { rental_history: history, ...rest } = tenant;
        stored.tenant = merged(stored.tenant, rest);
        if (history) {
          stored.tenant.rental_history = history.map((entry) => ({ ...entry, id: entry.id ?? `entry-${++ids}` }));
        }
      }
      if (landlord && stored.landlord) stored.landlord = merged(stored.landlord, landlord);
      if (settings) stored.settings = merged(stored.settings, settings);
      stored.updated_at = new Date(Date.parse(stored.updated_at) + 1000).toISOString();
      return structuredClone(stored);
    },
  };
}
