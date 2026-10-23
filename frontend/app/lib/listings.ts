// The listing and application flow's names and rules (R25), shared by the
// owner, tenant and public pages. Nothing here sends a request: the calls are
// api.properties and api.applications in lib/api.ts.

import type {
  Application,
  ApplicationInput,
  ApplicationStage,
  ListingStatus,
  Property,
  SettableListingStatus,
} from './api';
import { numberOrNull, sydneyToday, textOrNull, type MyProfile } from './my-profile';

/** The property types a listing can have; the API stores any other as other. */
export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  apartment: 'Apartment',
  house: 'House',
  townhouse: 'Townhouse',
  unit: 'Unit',
  studio: 'Studio',
  duplex: 'Duplex',
  other: 'Other',
};

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  paused: 'Paused',
  applications_closed: 'Applications closed',
  leased: 'Leased',
};

/** Pill colours: the brand's for a listing tenants can find, quieter ones for the rest. */
export const LISTING_STATUS_STYLES: Record<ListingStatus, string> = {
  draft: 'border-control-border bg-white text-text-body',
  published: 'border-success bg-white text-success',
  paused: 'border-warning bg-white text-warning',
  applications_closed: 'border-warning bg-white text-warning',
  leased: 'border-primary-strong bg-white text-primary-strong',
};

/** A listing's exact status; an older response that lacks it is read from the web status. */
export function listingStatusOf(property: Pick<Property, 'status' | 'listing_status'>): ListingStatus {
  if (property.listing_status) return property.listing_status;
  if (property.status === 'rented') return 'leased';
  return property.status === 'off_market' ? 'paused' : 'published';
}

/** Whether anyone may open the listing's public page: published, or closed to new applications only. */
export function isPublicStatus(status: ListingStatus): boolean {
  return status === 'published' || status === 'applications_closed';
}

export type ListingAction = {
  /** The status it moves the listing to, or archive (api.properties.remove). */
  to: SettableListingStatus | 'archive';
  label: string;
  /** What it does, shown before it is confirmed. */
  effect: string;
  destructive?: boolean;
};

const ARCHIVE: ListingAction = {
  to: 'archive',
  label: 'Delete listing',
  effect: "The listing, its photos and its applications are removed from TenantVoice, and its page stops working. This can't be undone.",
  destructive: true,
};
const PAUSE: ListingAction = {
  to: 'paused',
  label: 'Pause listing',
  effect: 'The listing leaves the public listings. Its applications stay as they are.',
};

/**
 * What an owner can do from each status, the likeliest first: the moves the
 * shared database allows (backend maps_rental.LISTING_MOVES), which the API
 * refuses otherwise. Nothing goes back to a draft, a listing closed to
 * applications reopens but never pauses, and only approving an application
 * leases a listing. A leased listing has no move: it can't be deleted either.
 */
export function listingActions(status: ListingStatus): ListingAction[] {
  switch (status) {
    case 'draft':
      return [{ to: 'published', label: 'Publish listing', effect: 'Tenants can find the listing and apply.' }, ARCHIVE];
    case 'published':
      return [
        { to: 'applications_closed', label: 'Close applications', effect: 'The listing stays public, but nobody new can apply.' },
        PAUSE,
        ARCHIVE,
      ];
    case 'applications_closed':
      return [{ to: 'published', label: 'Reopen applications', effect: 'Tenants can apply again.' }, ARCHIVE];
    case 'paused':
      return [{ to: 'published', label: 'Publish again', effect: 'Tenants can find the listing and apply.' }, ARCHIVE];
    case 'leased':
      return [];
  }
}

/** What the status controls say beside the moves: how a listing comes to be leased, and what that means. */
export function listingStatusNote(status: ListingStatus): string | null {
  if (status === 'leased') {
    return 'You approved an application, so this listing is leased and its status no longer changes. To let the home again, create a new listing.';
  }
  if (status === 'published' || status === 'applications_closed') {
    return 'Approving an application leases the listing and declines the other open applications.';
  }
  return null;
}

export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};

export const APPLICATION_STAGE_STYLES: Record<ApplicationStage, string> = {
  submitted: 'border-primary-strong text-primary-strong',
  under_review: 'border-warning text-warning',
  shortlisted: 'border-warning text-warning',
  approved: 'border-success text-success',
  declined: 'border-danger text-danger',
  withdrawn: 'border-control-border text-text-body',
  expired: 'border-control-border text-text-body',
};

/** An application's stage; an older response that lacks it is read from the web status. */
export function stageOf(application: Pick<Application, 'status' | 'stage' | 'shortlisted'>): ApplicationStage {
  if (application.stage) return application.stage;
  if (application.status === 'new') return 'submitted';
  if (application.status === 'reviewing') return application.shortlisted ? 'shortlisted' : 'under_review';
  return application.status;
}

/** Stages the landlord still has to decide. */
export function isOpenStage(stage: ApplicationStage): boolean {
  return stage === 'submitted' || stage === 'under_review' || stage === 'shortlisted';
}

/** Whether the tenant may still withdraw: only until the landlord decides. */
export function canWithdraw(application: Pick<Application, 'status' | 'stage' | 'shortlisted' | 'can_withdraw'>): boolean {
  return application.can_withdraw ?? isOpenStage(stageOf(application));
}

/** The landlord's newest note to the applicant, which goes with a decision. */
export function decisionNote(application: Pick<Application, 'history'>): string | null {
  const steps = application.history ?? [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].by === 'landlord' && steps[index].note) return steps[index].note;
  }
  return null;
}

// The listing photo bucket's own limits, which POST /uploads/property-image enforces.
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

// How many photos and features a listing keeps, as the API takes them
// (backend schemas/properties.py, PropertyCreate and PropertyUpdate), and
// the longest feature it keeps (Amenity there).
export const MAX_PHOTOS = 30;
export const MAX_FEATURES = 40;
export const MAX_FEATURE_LENGTH = 60;

/**
 * The features a listing can be given from `options`, every listing's
 * (GET /properties/amenities), which other apps write too: only those the
 * API keeps, so none is chosen only for the save to refuse it.
 */
export function featureOptions(options: string[]): string[] {
  return options.filter((option) => option.length <= MAX_FEATURE_LENGTH);
}

/**
 * The chosen photos a listing holding `kept` (saved or on their way up) has
 * room for, and why each other one is not sent: none is uploaded, public at
 * once, only for the save to refuse it.
 */
export function photosWithinLimit(kept: number, files: File[]): { accepted: File[]; refused: string[] } {
  const room = Math.max(0, MAX_PHOTOS - kept);
  return {
    accepted: files.slice(0, room),
    refused: files.slice(room).map((file) => `${file.name}: a listing takes up to ${MAX_PHOTOS} photos.`),
  };
}

/** Why a chosen file cannot be a listing photo, before anything is sent. */
export function photoRefusal(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return `${file.name}: choose a JPEG, PNG, WebP or GIF image.`;
  if (file.size > MAX_PHOTO_BYTES) return `${file.name}: photos can be up to 3 MB.`;
  return null;
}

/** "Wollongong, NSW 2500": where a listing is, without the street. */
export function localityOf(property: Pick<Property, 'suburb' | 'state' | 'postcode'>): string {
  const place = [property.state, property.postcode].filter(Boolean).join(' ');
  return [property.suburb, place].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------
/** The apply form's fields, as text boxes hold them. */
export type ApplicationDraft = {
  moveInDate: string;
  occupants: string;
  hasPets: boolean;
  pets: string;
  offer: string;
  about: string;
  income: string;
  message: string;
  documentIds: string[];
};

/** Which fields came from the tenant's saved profile, to say so beside them. */
export type PrefilledFields = Partial<Record<'moveInDate' | 'occupants' | 'hasPets' | 'pets' | 'offer' | 'about', true>>;

const MAX_OCCUPANTS = 20;

/**
 * The apply form filled from the tenant's saved profile: the move-in date
 * (unless it has passed), household size, pets, the weekly budget as the
 * offer (never above the asking rent) and the about line. The tenant can
 * change every field before sending; the server copies nothing itself.
 */
export function prefillApplication(
  profile: MyProfile | null,
  askingRent: number,
  today: string = sydneyToday(),
): { draft: ApplicationDraft; prefilled: PrefilledFields } {
  const tenant = profile?.tenant ?? null;
  const prefilled: PrefilledFields = {};
  const moveIn = tenant?.move_in_date && tenant.move_in_date >= today ? tenant.move_in_date : '';
  if (moveIn) prefilled.moveInDate = true;
  const occupants = tenant?.household_size && tenant.household_size <= MAX_OCCUPANTS ? String(tenant.household_size) : '';
  if (occupants) prefilled.occupants = true;
  if (tenant?.has_pets) prefilled.hasPets = true;
  const pets = tenant?.has_pets ? tenant.household?.pets?.trim() ?? '' : '';
  if (pets) prefilled.pets = true;
  const budget = tenant?.budget_max ?? null;
  const offer = budget !== null && budget > 0 && budget < askingRent ? budget : askingRent;
  if (budget !== null && budget > 0) prefilled.offer = true;
  const about = tenant?.about_me?.trim() ?? '';
  if (about) prefilled.about = true;
  return {
    draft: {
      moveInDate: moveIn,
      occupants,
      hasPets: tenant?.has_pets ?? false,
      pets,
      offer: String(offer),
      about,
      income: '',
      message: '',
      documentIds: [],
    },
    prefilled,
  };
}

/** The request for a draft, or the first thing to fix; the server checks it all again. */
export function applicationInput(
  propertyId: string,
  draft: ApplicationDraft,
  today: string = sydneyToday(),
): { input: ApplicationInput } | { error: string; field: keyof ApplicationDraft } {
  const occupants = numberOrNull(draft.occupants);
  const offer = numberOrNull(draft.offer);
  const income = numberOrNull(draft.income);
  if (draft.moveInDate && draft.moveInDate < today) {
    return { error: 'Choose a move-in date from today on.', field: 'moveInDate' };
  }
  if (occupants !== null && (!Number.isInteger(occupants) || occupants < 1 || occupants > MAX_OCCUPANTS)) {
    return { error: `Enter how many people will live there, from 1 to ${MAX_OCCUPANTS}.`, field: 'occupants' };
  }
  if (offer !== null && (!Number.isFinite(offer) || offer <= 0)) {
    return { error: 'Enter the weekly rent you offer, or leave it empty to offer the asking rent.', field: 'offer' };
  }
  if (income !== null && (!Number.isFinite(income) || income < 0)) {
    return { error: 'Enter your yearly income as a number, or leave it empty.', field: 'income' };
  }
  return {
    input: {
      property_id: propertyId,
      move_in_date: draft.moveInDate || null,
      occupants,
      has_pets: draft.hasPets,
      pets: draft.hasPets ? textOrNull(draft.pets) : null,
      rent_offered: offer,
      about: textOrNull(draft.about),
      annual_income: income,
      message: textOrNull(draft.message),
      document_ids: draft.documentIds,
    },
  };
}
