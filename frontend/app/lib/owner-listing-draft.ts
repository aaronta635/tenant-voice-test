// Carries the create-listing wizard's fields across its three step routes.
// Backed by sessionStorage so a refresh mid-wizard doesn't lose progress; the
// final step converts it into a PropertyInput and POSTs it.

import type { PropertyInput } from '@/app/lib/api';

export type ListingDraft = {
  title?: string;
  address?: string;
  suburb?: string;
  state?: string;
  property_type?: string;
  postcode?: string;
  bedrooms?: string;
  bathrooms?: string;
  description?: string;
  amenities?: string[];
  price?: string;
  bond?: string;
  lease_term?: string;
  available_from?: string;
};

const KEY = 'tv_listing_draft';

export function getDraft(): ListingDraft {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as ListingDraft;
  } catch {
    return {};
  }
}

export function saveDraft(patch: Partial<ListingDraft>) {
  if (typeof window === 'undefined') return;
  const next = { ...getDraft(), ...patch };
  sessionStorage.setItem(KEY, JSON.stringify(next));
}

export function clearDraft() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(KEY);
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Build the API payload from the accumulated draft. Returns an error string if invalid. */
export function draftToPropertyInput(
  draft: ListingDraft,
): { input: PropertyInput } | { error: string } {
  const title = draft.title?.trim() || draft.address?.trim();
  const address = draft.address?.trim();
  const price = toNumber(draft.price);

  if (!title) return { error: 'A listing title or address is required.' };
  if (!address) return { error: 'A property address is required.' };
  if (price === undefined) return { error: 'A weekly rent amount is required.' };

  const input: PropertyInput = {
    title,
    address,
    price,
    suburb: draft.suburb?.trim() || null,
    state: draft.state?.trim() || null,
    postcode: draft.postcode?.trim() || null,
    property_type: draft.property_type?.trim() || null,
    bedrooms: toNumber(draft.bedrooms) ?? null,
    bathrooms: toNumber(draft.bathrooms) ?? null,
    bond: toNumber(draft.bond) ?? null,
    lease_term: draft.lease_term?.trim() || null,
    available_from: draft.available_from || null,
    description: draft.description?.trim() || null,
    amenities: draft.amenities && draft.amenities.length > 0 ? draft.amenities : null,
    status: 'available',
  };
  return { input };
}
