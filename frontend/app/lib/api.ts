// Thin typed client for the TenantVoice FastAPI backend.
// The frontend talks ONLY to this API (Supabase is backend-only). The backend
// hands us a Supabase-issued JWT at login/register; we keep it in a cookie so
// every subsequent request can send it as a Bearer token.
//
// There is no mock data anywhere in the frontend — every list, counter and
// label a screen renders comes back from one of the calls declared here.

import type { AccountStandingOut } from './account-standing';
import type { ComplaintStep } from './complaint-categories';
import type {
  AnalyticsDays,
  ListingAnalytics,
  OwnerListingPerformance,
  RentalHistoryItem,
  RentCharge,
  TenantLease,
  UpcomingInspection,
} from './dashboards';
import type { OnboardingProgress } from './onboarding';
import type { OwnerAssistantAnswer, OwnerAssistantConfirmation, OwnerAssistantWorkspace } from './owner-assistant';
import type { SessionRole } from './session-role';
import type { VerificationRequiredDetail } from './verification-gate';
import { clearSessionRole, isUnexpiredJwt, parseRole, sessionCookie, setSessionRole } from './session-role';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

export const TOKEN_COOKIE = 'tv_token';
export const REFRESH_TOKEN_KEY = 'tv_refresh_token';

// ---------------------------------------------------------------------------
// Role mapping: the UI thinks in Client/Provider/Owner; the database enum is
// tenant/service_provider/landlord.
// ---------------------------------------------------------------------------
export type BackendRole = 'tenant' | 'landlord' | 'service_provider';

const UI_TO_BACKEND: Record<SessionRole, BackendRole> = {
  Client: 'tenant',
  Provider: 'service_provider',
  Owner: 'landlord',
};

const BACKEND_TO_UI: Record<BackendRole, SessionRole> = {
  tenant: 'Client',
  service_provider: 'Provider',
  landlord: 'Owner',
};

export function toBackendRole(role: SessionRole): BackendRole {
  return UI_TO_BACKEND[role];
}

export function toSessionRole(role: string): SessionRole | null {
  return (BACKEND_TO_UI as Record<string, SessionRole>)[role] ?? null;
}

// ---------------------------------------------------------------------------
// Token storage (client-side). Cookie so server components / middleware can
// read it too; localStorage as a resilient mirror.
// ---------------------------------------------------------------------------
const ACCESS_TOKEN_MAX_AGE = 60 * 60 * 24 * 7; // keep cookie for a week; JWT refresh handles expiry

export function setAuthToken(token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_COOKIE, token);
  document.cookie = sessionCookie(TOKEN_COOKIE, token, ACCESS_TOKEN_MAX_AGE);
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromCookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TOKEN_COOKIE}=`));
  if (fromCookie) return decodeURIComponent(fromCookie.slice(TOKEN_COOKIE.length + 1));
  // Middleware treats a missing cookie as signed out, so an expired mirror is a
  // finished session; only an unexpired one (awaiting migration) still counts.
  const mirror = localStorage.getItem(TOKEN_COOKIE);
  return isUnexpiredJwt(mirror) ? mirror : null;
}

export function setRefreshToken(token: string | null | undefined) {
  if (typeof window === 'undefined') return;
  if (!token) {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    return;
  }
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function clearAuthToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_COOKIE);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  document.cookie = sessionCookie(TOKEN_COOKIE, '', 0);
}

/** Persist both the JWT and the UI role cookie after a successful auth. */
export function setAuthSession(
  token: string,
  role: SessionRole,
  refreshToken?: string | null,
) {
  authEpoch += 1;
  pendingRecovery = null;
  setAuthToken(token);
  setRefreshToken(refreshToken);
  if (typeof window === 'undefined') return;
  localStorage.removeItem('tv_explicit_logout');
  setSessionRole(role);
  window.dispatchEvent(new Event('tenantvoice:session-restored'));
}

export function clearAuthSession() {
  authEpoch += 1;
  pendingRecovery = null;
  clearAuthToken();
  clearSessionRole();
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------
/** The answer header a refused token on an optional sign-in carries (backend core/deps.py). */
const SESSION_EXPIRED_HEADER = 'X-Session-Expired';

export class ApiError extends Error {
  status: number;
  /** The response's detail as the API sent it, such as a verification gate's object (lib/verification-gate). */
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.name = 'ApiError';
  }
}

type FetchOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean; // attach bearer token (default true)
  token?: string; // explicit token (server-side callers)
  query?: Record<string, string | number | boolean | string[] | undefined | null>;
  /** Multipart payload. Mutually exclusive with `body`. */
  formData?: FormData;
};

function buildQuery(query?: FetchOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      // Repeated keys (?a=1&a=2) are how FastAPI reads list parameters.
      for (const item of value) if (item !== '') params.append(key, item);
    } else if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  return apiFetchInternal<T>(path, options, true);
}

type SessionRecovery = { id: number; role: string | null };
let authEpoch = 0;
let recoverySequence = 0;
let pendingRecovery: SessionRecovery | null = null;
let refreshInFlight: { epoch: number; promise: Promise<boolean> } | null = null;

/** A readable snapshot prevents an expiry event before mount/HMR being lost. */
export function getSessionRecovery(): SessionRecovery | null { return pendingRecovery; }
export function subscribeToSessionRecovery(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== TOKEN_COOKIE || !event.newValue || !getAuthToken()) return;
    authEpoch += 1;
    pendingRecovery = null;
    listener();
  };
  window.addEventListener('tenantvoice:session-expired', listener);
  window.addEventListener('tenantvoice:session-restored', listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('tenantvoice:session-expired', listener);
    window.removeEventListener('tenantvoice:session-restored', listener);
    window.removeEventListener('storage', onStorage);
  };
}

function notifySessionExpired() {
  if (typeof window === 'undefined' || pendingRecovery) return;
  const role = localStorage.getItem('tv_role');
  clearAuthSession();
  pendingRecovery = { id: ++recoverySequence, role };
  // Keep unsaved component state in this tab; reauthentication opens separately.
  window.dispatchEvent(new CustomEvent('tenantvoice:session-expired', { detail: { role } }));
}

async function tryRefreshSession(): Promise<boolean> {
  const epoch = authEpoch;
  if (refreshInFlight?.epoch === epoch) return refreshInFlight.promise;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const flight = { epoch, promise: Promise.resolve(false) };
  refreshInFlight = flight;
  flight.promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }), cache: 'no-store',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as AuthResponse;
      // Signing out or signing into another account must invalidate old refreshes.
      if (!data.access_token || authEpoch !== epoch || getRefreshToken() !== refreshToken) return false;
      setAuthToken(data.access_token);
      if (data.refresh_token) setRefreshToken(data.refresh_token);
      // Renew the role cookie with the token so it never expires first.
      const role = parseRole(localStorage.getItem('tv_role'));
      if (role) setSessionRole(role);
      return true;
    } catch { return false; }
    finally { if (refreshInFlight === flight) refreshInFlight = null; }
  })();
  return flight.promise;
}

async function apiFetchInternal<T>(
  path: string,
  options: FetchOptions,
  allowRefresh: boolean,
): Promise<T> {
  const { method = 'GET', body, auth = true, token, query, formData } = options;
  const requestEpoch = authEpoch;

  const headers: Record<string, string> = {};
  // Never set Content-Type for FormData — the browser must add the multipart
  // boundary itself.
  if (formData === undefined && body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const bearer = token ?? (auth ? getAuthToken() : null);
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;

  const res = await fetch(`${API_BASE}${path}${buildQuery(query)}`, {
    method,
    headers,
    body: formData ?? (body === undefined ? undefined : JSON.stringify(body)),
    cache: 'no-store',
  }).catch(() => { throw new ApiError(0, 'Could not connect. Check your connection and try again.'); });

  // A page anyone may open (a listing, the catalogue) answers a token it
  // refused as signed out, and says so (backend core/deps.py). Refresh the
  // session and ask once more, so a member never sees the signed-out page.
  if (res.ok && allowRefresh && bearer && !token && res.headers?.get?.(SESSION_EXPIRED_HEADER) && requestEpoch === authEpoch) {
    const currentBearer = getAuthToken();
    if (currentBearer && currentBearer !== bearer) return apiFetchInternal<T>(path, options, false);
    if (await tryRefreshSession()) return apiFetchInternal<T>(path, options, false);
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message = res.status === 401 && path === '/auth/login' ? 'Email or password is incorrect.' : friendlyApiError(res.status, data);
    const isAuthFailure =
      res.status === 401 &&
      auth &&
      !token &&
      path !== '/auth/refresh' &&
      path !== '/auth/login' &&
      path !== '/auth/register';

    if (isAuthFailure && requestEpoch === authEpoch) {
      // Another concurrent request may already have rotated this access token.
      const currentBearer = getAuthToken();
      if (allowRefresh && bearer && currentBearer && currentBearer !== bearer) {
        return apiFetchInternal<T>(path, options, false);
      }
      if (allowRefresh && await tryRefreshSession()) {
        return apiFetchInternal<T>(path, options, false);
      }
      // A failed retried request is still an expired session. Never let the
      // no-more-refresh flag suppress recovery, or a stale request log out a new login.
      if (requestEpoch === authEpoch) notifySessionExpired();
    }

    const detail = typeof data === 'object' && data !== null && 'detail' in data ? (data as { detail: unknown }).detail : undefined;
    throw new ApiError(res.status, message, detail);
  }

  return data as T;
}

export function friendlyApiError(status: number, data: unknown): string {
  if (status >= 500) return 'The service is temporarily unavailable. Please try again.';
  if (status === 401) return 'Your session has expired. Sign in again to continue; your unsaved work stays in this tab.';
  if (typeof data === 'object' && data !== null && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail;
    if (Array.isArray(detail)) {
      return detail.slice(0, 3).map((item: { loc?: (string | number)[]; msg?: string }) => {
        const field = (item.loc ?? []).filter((part) => part !== 'body' && part !== 'query').join(' ').replaceAll('_', ' ');
        return `${field ? `${field}: ` : ''}${item.msg ?? 'Please check this value.'}`;
      }).join(' ');
    }
    if (typeof detail === 'string' && !/[<>]/.test(detail)) return detail;
    // An object detail, such as a verification gate's, carries its sentence for the person.
    const sentence = typeof detail === 'object' && detail !== null ? (detail as { message?: unknown }).message : undefined;
    if (typeof sentence === 'string' && sentence && !/[<>]/.test(sentence)) return sentence;
  }
  if (status === 403) return 'You do not have access to this action.';
  if (status === 404) return 'This item could not be found.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  return 'This request could not be completed. Please check your details and try again.';
}

/** Small helper for read-only screens: resolve to a fallback instead of throwing. */
/**
 * For "load the page's data" calls: a 404 means "nothing yet" (e.g. no
 * provider profile) and resolves to the fallback, but any other failure is
 * re-thrown so the page can show an error instead of a misleading empty state.
 */
export async function orNotFound<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return fallback;
    throw err;
  }
}

export async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Domain types (mirror backend Pydantic schemas)
// ---------------------------------------------------------------------------
export type Profile = {
  id: string;
  role: BackendRole | string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  phone: string | null;
  location: string | null;
  state: string | null;
  postcode: string | null;
  created_at: string;
  updated_at: string;
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string | null;
  token_type: string;
  expires_at: number | null;
  profile: Profile;
};

export type PropertyStatus = 'available' | 'rented' | 'off_market';
/** listings.status as the API names it; finer than PropertyStatus. */
export type ListingStatus = 'draft' | 'published' | 'paused' | 'applications_closed' | 'leased';
/** What an owner can move a listing to; archiving is api.properties.remove. */
export type SettableListingStatus = Exclude<ListingStatus, 'draft'>;

/** The listing's landlord as their public profile shows them. */
export type ListingLandlord = {
  id: string;
  display_name: string;
  role_label: string;
  avatar_url: string | null;
  verified: boolean;
  rating_avg: number | null;
  review_count: number;
};

/** Who is looking, as the API read their token: no role means signed out. */
export type ListingViewer = {
  role: string | null;
  is_owner: boolean;
  liked: boolean;
  application: { id: string; stage: ApplicationStage; can_withdraw: boolean; created_at: string } | null;
};

export type Property = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  address: string;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  price: number;
  bond: number | null;
  lease_term: string | null;
  available_from: string | null;
  amenities: string[] | null;
  photo_urls: string[] | null;
  status: PropertyStatus;
  listing_status?: ListingStatus;
  rating_avg: number;
  review_count: number;
  created_at: string;
  updated_at: string;
  /** Owner responses: the street line an edit's address replaces (address is the whole address). */
  street_address?: string | null;
  /** Owner responses: applications still on the listing, and the new ones among them. */
  application_count?: number;
  new_application_count?: number;
  /** Public responses: signed out, address is the suburb, state and postcode only. */
  address_hidden?: boolean;
  accepting_applications?: boolean;
  /** The listing page only. */
  like_count?: number | null;
  landlord?: ListingLandlord | null;
  viewer?: ListingViewer | null;
};

export type PropertyInput = {
  title: string;
  description?: string | null;
  address: string;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  property_type?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  parking?: number | null;
  price: number;
  bond?: number | null;
  lease_term?: string | null;
  available_from?: string | null;
  amenities?: string[] | null;
  photo_urls?: string[] | null;
  status?: PropertyStatus;
};

/** An edit: only the fields sent change, and a null clears an optional one. */
export type PropertyUpdate = Partial<PropertyInput> & { listing_status?: SettableListingStatus };

export type ApplicationStatus = 'new' | 'reviewing' | 'approved' | 'declined';
/** The application's shared status, finer than ApplicationStatus. */
export type ApplicationStage =
  'submitted' | 'under_review' | 'shortlisted' | 'approved' | 'declined' | 'withdrawn' | 'expired';

/** A document that went with an application. */
export type ApplicationDocument = {
  id: string;
  document_type: string;
  label: string;
  verified: boolean;
  /** The tenant still shares it; owners only ever get shared ones. */
  shared: boolean;
};

/** One step of an application's history. */
export type ApplicationEvent = {
  from_stage: ApplicationStage | null;
  to_stage: ApplicationStage;
  note: string | null;
  by: 'applicant' | 'landlord' | null;
  created_at: string;
};

/** The listing on the tenant's own applications. */
export type ApplicationListing = {
  id: string;
  title: string;
  suburb: string | null;
  state: string | null;
  photo_url: string | null;
  weekly_rent: number | null;
  is_public: boolean;
};

export type Application = {
  id: string;
  property_id: string;
  tenant_id: string;
  status: ApplicationStatus;
  annual_income: number | null;
  move_in_date: string | null;
  rent_offered: number | null;
  tenant_score: number | null;
  shortlisted: boolean;
  has_pets: boolean;
  message: string | null;
  created_at: string;
  updated_at: string;
  stage?: ApplicationStage;
  /** The tenant may still withdraw it: the landlord has not decided. */
  can_withdraw?: boolean;
  /** What the tenant shared when applying. */
  occupants?: number | null;
  pets?: string | null;
  about?: string | null;
  documents?: ApplicationDocument[];
  history?: ApplicationEvent[];
  /** The tenant's own list only. */
  listing?: ApplicationListing | null;
  // Present only on landlord-facing responses (list-for-property / update).
  tenant_name?: string | null;
  tenant_phone?: string | null;
  tenant_verified?: boolean | null;
  tenant_rating_avg?: number | null;
  tenant_review_count?: number | null;
};

export type ApplicationInput = {
  property_id: string;
  annual_income?: number | null;
  move_in_date?: string | null;
  occupants?: number | null;
  rent_offered?: number | null;
  has_pets?: boolean;
  pets?: string | null;
  about?: string | null;
  message?: string | null;
  /** Profile documents the tenant marked shareable with landlords. */
  document_ids?: string[];
};

export type PropertyFilters = {
  location?: string;
  property_type?: string;
  min_price?: number;
  max_price?: number;
  bedrooms?: number;
  sort?: 'newest' | 'price_asc' | 'price_desc';
  limit?: number;
  offset?: number;
};

// --- Marketplace -----------------------------------------------------------
export type Category = {
  slug: string;
  category: string;
  name: string;
  description: string;
  icon_bg: string | null;
  badge: string | null;
  sort_order: number;
  provider_count: number;
  from_price: number | null;
};

export type ProviderProfileSummary = {
  full_name: string;
  avatar_url: string | null;
  location: string | null;
  state: string | null;
  postcode: string | null;
  phone: string | null;
};

export type ServiceProvider = {
  id: string;
  profile_id: string;
  // Null until the provider picks one in onboarding step 1.
  category: string | null;
  slug: string | null;
  business_name: string | null;
  abn: string | null;
  tagline: string | null;
  bio: string | null;
  headline: string | null;
  badge_label: string | null;
  years_experience: number | null;
  languages: string[] | null;
  skills: string[] | null;
  specialties: string[] | null;
  gallery_urls: string[] | null;
  service_radius_km: number | null;
  website: string | null;
  response_time: string | null;
  availability_note: string | null;
  is_online: boolean;
  is_published: boolean;
  profile_completion: number;
  rating_avg: number;
  review_count: number;
  created_at: string;
  updated_at: string;
};

export type PublicProvider = ServiceProvider & {
  completed_jobs: number;
  profiles: ProviderProfileSummary | null;
  category_name: string | null;
  category_slug: string | null;
  verifications: string[];
  from_price: number | null;
  price_unit: string | null;
  service_count: number;
};

export type ProviderFilters = {
  category?: string;
  location?: string;
  min_rating?: number;
  search?: string;
  sort?: 'rating' | 'newest' | 'reviews';
  limit?: number;
  offset?: number;
};

export type ProviderService = {
  id: string;
  provider_id: string;
  title: string;
  description: string | null;
  pricing_type: 'flat' | 'hourly' | 'from';
  price: number;
  duration_minutes: number | null;
  inclusions: string | null;
  exclusions: string | null;
  service_area: string | null;
  /** One of the eight shared codes (lib/repair-categories); GENERAL by default. */
  category: string;
  cancellation_policy: string | null;
  is_active: boolean;
  sort_order: number;
  booking_count: number;
  created_at: string;
  updated_at: string;
};

export type ProviderServiceInput = {
  title: string;
  description?: string | null;
  pricing_type?: ProviderService['pricing_type'];
  price: number;
  duration_minutes?: number | null;
  inclusions?: string | null;
  exclusions?: string | null;
  service_area?: string | null;
  category?: string;
  cancellation_policy?: string | null;
  is_active?: boolean;
  sort_order?: number;
};

export type Availability = {
  id: string;
  provider_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
};

export type VerificationDocument = {
  id: string;
  provider_id: string;
  type: 'id' | 'licence' | 'insurance' | 'abn' | 'other';
  label: string | null;
  document_url: string | null;
  status: 'pending' | 'verified' | 'rejected';
  /** Why an admin rejected it; null unless the status is rejected. */
  rejection_reason?: string | null;
  verified_at: string | null;
  created_at: string;
};

export type PortfolioItem = {
  id: string;
  provider_id: string;
  title: string | null;
  description: string | null;
  image_url: string;
  sort_order: number;
  created_at: string;
};

// --- Bookings / reviews / money -------------------------------------------
export type BookingStatus =
  | 'new_enquiry'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'cancelled';

export type Booking = {
  id: string;
  client_id: string;
  provider_id: string;
  service_id: string | null;
  status: BookingStatus;
  property_address: string | null;
  property_suburb: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  price: number | null;
  notes: string | null;
  completion_report: string | null;
  created_at: string;
  updated_at: string;
  client_name: string | null;
  client_avatar_url: string | null;
  provider_name: string | null;
  service_title: string | null;
  review_rating: number | null;
  unread_count: number;
  conversation_id: string | null;
};

export type Review = {
  id: string;
  booking_id: string | null;
  property_id?: string | null;
  provider_id: string;
  client_id: string;
  rating: number;
  comment: string | null;
  provider_reply: string | null;
  replied_at: string | null;
  is_flagged: boolean;
  created_at: string;
  client_name: string | null;
  client_avatar_url: string | null;
  service_title: string | null;
  location: string | null;
};

export type Transaction = {
  id: string;
  provider_id: string;
  booking_id: string | null;
  type: 'payment' | 'refund' | 'platform_fee' | 'payout';
  amount: number;
  description: string | null;
  created_at: string;
  client_name: string | null;
  client_avatar_url: string | null;
  service_title: string | null;
  booking_status: BookingStatus | null;
};

export type Invoice = {
  id: string;
  provider_id: string;
  booking_id: string | null;
  number: string;
  amount: number;
  status: 'draft' | 'issued' | 'paid' | 'void';
  issued_at: string | null;
  due_date: string | null;
  document_url: string | null;
  created_at: string;
};

export type InvoiceDocument = Invoice & {
  provider: { name: string | null; abn: string | null; location: string | null; phone: string | null };
  client: { name: string | null; location: string | null };
  lines: { description: string; detail: string | null; amount: number }[];
};

// --- Messaging -------------------------------------------------------------
export type ConversationKind = 'marketplace' | 'rental';

export type ConversationBooking = {
  id: string;
  status: string;
  service_title: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  property_address: string | null;
  price: number | null;
};

export type Conversation = {
  id: string;
  kind: ConversationKind;
  client_id: string | null;
  provider_id: string | null;
  owner_id: string | null;
  tenant_id: string | null;
  property_id: string | null;
  booking_id: string | null;
  subject: string | null;
  last_message_at: string | null;
  created_at: string;
  counterpart_id: string | null;
  counterpart_name: string | null;
  counterpart_role: string | null;
  counterpart_avatar_url: string | null;
  context: string | null;
  last_message: string | null;
  last_message_sender_id?: string | null;
  unread_count: number;
  booking: ConversationBooking | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string | null;
  body: string;
  attachment_url: string | null;
  is_read: boolean;
  created_at: string;
};

// --- Network / plans / content --------------------------------------------
export type ConnectionStatus = 'pending' | 'accepted' | 'declined';

export type Connection = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: ConnectionStatus;
  created_at: string;
  responded_at: string | null;
  person_id: string;
  person_name: string;
  person_role: string;
  person_avatar_url: string | null;
  person_location: string | null;
  direction: 'incoming' | 'outgoing';
};

export type ProfileSearchResult = {
  id: string;
  full_name: string;
  role: string;
  avatar_url: string | null;
  location: string | null;
  state: string | null;
  connection_status: ConnectionStatus | null;
};

export type Plan = {
  id: string;
  code: string;
  name: string;
  audience: string;
  price: number;
  billing_period: string;
  description: string | null;
  features: string[];
  is_popular: boolean;
  sort_order: number;
  is_current: boolean;
};

export type Subscription = {
  id: string;
  user_id: string;
  plan_id: string;
  status: 'active' | 'cancelled' | 'expired';
  started_at: string;
  renews_at: string | null;
  plan: Plan | null;
};

export type Faq = {
  id: string;
  audience: string;
  question: string;
  answer: string;
  sort_order: number;
};

export type SupportContact = { email: string; phone: string };

export type PlatformStats = {
  verified_providers: number;
  jobs_completed: number;
  average_rating: number;
  satisfaction_pct: number;
  review_count: number;
  category_count: number;
};

export type NotificationItem = {
  id: string;
  user_id: string;
  category: 'message' | 'booking' | 'application' | 'review' | 'property' | 'account' | 'system';
  title: string;
  body: string | null;
  link_href: string | null;
  is_read: boolean;
  created_at: string;
};

export type Inspection = {
  id: string;
  property_id: string;
  starts_at: string;
  duration_minutes: number;
  capacity: number | null;
  notes: string | null;
};

// --- Dashboards ------------------------------------------------------------
export type ProviderDashboard = {
  active_bookings: number;
  new_enquiries: number;
  due_this_week: number;
  overdue_bookings?: number;
  decided_enquiries?: number;
  completed_bookings: number;
  month_earnings: number;
  previous_month_earnings: number;
  month_change_pct: number | null;
  rating_avg: number;
  review_count: number;
  awaiting_reply: number;
  unread_messages: number;
  profile_completion: number;
  service_count: number;
  published_service_count: number;
  draft_service_count: number;
  booking_conversion_pct: number | null;
  total_enquiries: number;
};

export type MonthlyPoint = { month: string; label: string; amount: number };

export type ProviderFinance = {
  available_balance: number;
  pending_payments: number;
  month_earnings: number;
  total_payouts: number;
  upcoming_payouts: number;
  ytd_earnings: number;
  lifetime_earnings: number;
  yoy_change_pct: number | null;
  monthly: MonthlyPoint[];
};

export type OwnerBadges = Pick<
  OwnerDashboard,
  'new_application_count' | 'unread_messages' | 'pending_connections' | 'unread_notifications'
>;

export type OwnerDashboard = {
  property_count: number;
  available_count: number;
  rented_count: number;
  application_count: number;
  new_application_count: number;
  /** Active rent agreements: one at most per listing. */
  active_lease_count: number;
  /** The share of the owner's listings under an active agreement; null without listings. */
  occupancy_pct: number | null;
  active_complaint_count: number;
  upcoming_inspection_count: number;
  /** The soonest few; upcoming_inspection_count counts them all. */
  upcoming_inspections: UpcomingInspection[];
  review_count: number;
  rating_avg: number | null;
  reviews_awaiting_reply: number;
  favourite_count: number;
  /** Listing views over the last view_days days; null until the views table exists (views_available). */
  view_count: number | null;
  views_available: boolean;
  view_days: number;
  listings: OwnerListingPerformance[];
  unread_messages: number;
  pending_connections: number;
  unread_notifications: number;
};

export type TenantDashboard = {
  /** An active rent agreement. */
  has_tenancy: boolean;
  listing_id: string | null;
  listing_title: string | null;
  lease: TenantLease | null;
  /** The first issued charge not yet paid; null when nothing is due. */
  next_payment: RentCharge | null;
  overdue_count: number;
  overdue_amount: number;
  open_maintenance: number;
  upcoming_inspections: number;
  next_inspections: UpcomingInspection[];
  rental_history: RentalHistoryItem[];
  /** False when the tenancies on TenantVoice could not be read: the history holds the reported ones only. */
  rental_history_complete: boolean;
};

export type MaintenanceRequest = {
  id: string;
  property_id: string;
  tenant_id: string;
  owner_id: string;
  provider_id: string | null;
  category: string;
  priority: string;
  status: string;
  title: string;
  description: string;
  created_at: string;
  property_title: string | null;
  property_address: string | null;
};

// --- Provider recommendations ----------------------------------------------
export type ProviderRecommendationFilters = {
  role?: 'tenant' | 'landlord';
  location?: string;
  limit?: number;
  /** Only some of the provider's own active services; omitted = all. */
  service_ids?: string[];
  /** Leave out people with a pending or accepted connection. */
  new_only?: boolean;
};

/** Search criteria collected by the recommendation chat. null = not decided yet. */
export type RecommendationCriteria = {
  role: 'tenant' | 'landlord' | 'any' | null;
  /** '' means anywhere. */
  location: string | null;
  service_ids: string[];
  new_only: boolean;
};

export type RecommendationChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type RecommendationChatResponse = {
  reply: string;
  state: 'ask' | 'confirm';
  criteria: RecommendationCriteria;
  missing: ('role' | 'location')[];
  quick_replies: string[];
  services: { id: string; title: string }[];
  source: 'rules' | 'deepseek';
  /** verification_required: a model turn is the paid AI, so the guided questions answered (tracker R18). */
  ai_status: 'not_configured' | 'applied' | 'unavailable' | 'cooldown' | 'verification_required';
  /** Why the model was not asked; read it with refusalOf (lib/verification-gate). */
  verification?: VerificationRequiredDetail | null;
};

export type ProviderRecommendationLocation = {
  label: string;
  value: string;
};

export type ProviderRecommendation = {
  id: string;
  full_name: string;
  role: 'tenant' | 'landlord';
  avatar_url: string | null;
  location: string | null;
  state: string | null;
  connection_status: 'pending' | 'accepted' | 'declined' | null;
  match_level: 'strong' | 'possible' | 'explore';
  reasons: string[];
};

export type ProviderRecommendationsResponse = {
  items: ProviderRecommendation[];
  source: 'rules' | 'deepseek';
  /** verification_required: reranking is the paid AI, so the profile matches stand (tracker R18). */
  ai_status: 'not_configured' | 'ready' | 'applied' | 'unavailable' | 'cooldown' | 'verification_required';
  message: string | null;
  /** Why the model was not asked; read it with refusalOf (lib/verification-gate). */
  verification?: VerificationRequiredDetail | null;
  generated_at: string;
  cached: boolean;
};

// ---------------------------------------------------------------------------
// Typed API surface
// ---------------------------------------------------------------------------
/** A category's code from GET /complaint-categories (lib/complaint-categories). */
export type ComplaintCategory = string;
export type ComplaintStatus = 'open' | 'under_review' | 'resolved' | 'dismissed';

export type Complaint = {
  id: string;
  complainant_id: string;
  against_id: string | null;
  property_id: string | null;
  category: ComplaintCategory;
  /** The category's name; a value from before the fixed codes keeps its own. */
  category_label: string | null;
  /** complaints.severity: LOW, MEDIUM, HIGH or CRITICAL. */
  severity?: string | null;
  subject: string;
  description: string;
  status: ComplaintStatus;
  response: string | null;
  responded_at: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  is_escalated: boolean;
  evidence_urls: string[] | null;
  created_at: string;
  updated_at: string;
  complainant_name: string | null;
  against_name: string | null;
  property_title: string | null;
  /** Oldest first. */
  timeline: ComplaintStep[];
};

export type ComplaintInput = {
  subject: string;
  description: string;
  category: ComplaintCategory;
  /** LOW, MEDIUM (the default), HIGH or CRITICAL. */
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  against_id?: string | null;
  property_id?: string | null;
  evidence_urls?: string[] | null;
};

export type UploadResult = {
  url: string;
  path: string;
  content_type: string;
  size: number;
};

export const api = {
  auth: {
    register: (payload: {
      email: string;
      password: string;
      full_name: string;
      role: BackendRole;
    }) => apiFetch<AuthResponse>('/auth/register', { method: 'POST', body: payload, auth: false }),
    // role is the account type the user picked; the backend rejects the sign-in
    // if the account does not actually hold it.
    login: (payload: { email: string; password: string; role?: BackendRole }) =>
      apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: payload, auth: false }),
    refresh: (refreshToken: string) =>
      apiFetch<AuthResponse>('/auth/refresh', {
        method: 'POST',
        body: { refresh_token: refreshToken },
        auth: false,
      }),
    // 202 with the same message whether or not the address has an account.
    forgotPassword: (email: string) =>
      apiFetch<{ message: string }>('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),
    // access_token is the recovery session from the emailed link, never a sign-in.
    // 400: the link expired or was used; 422: the password was refused.
    resetPassword: (payload: { access_token: string; password: string }) =>
      apiFetch<{ message: string }>('/auth/reset-password', { method: 'POST', body: payload, auth: false }),
    me: (token?: string) => apiFetch<Profile>('/auth/me', { token }),
  },

  profiles: {
    me: () => apiFetch<Profile>('/profiles/me'),
    update: (payload: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at' | 'role'>>) =>
      apiFetch<Profile>('/profiles/me', { method: 'PATCH', body: payload }),
    search: (params: { search?: string; role?: string; limit?: number } = {}) =>
      apiFetch<ProfileSearchResult[]>('/profiles/search', { query: params }),
  },

  properties: {
    // Landlord-owned
    listMine: (status?: string) =>
      apiFetch<Property[]>('/me/properties', { query: { status } }),
    getMine: (id: string) => apiFetch<Property>(`/me/properties/${id}`),
    create: (payload: PropertyInput) =>
      apiFetch<Property>('/me/properties', { method: 'POST', body: payload }),
    update: (id: string, payload: PropertyUpdate) =>
      apiFetch<Property>(`/me/properties/${id}`, { method: 'PATCH', body: payload }),
    remove: (id: string) =>
      apiFetch<void>(`/me/properties/${id}`, { method: 'DELETE' }),
    /** A photo for a listing that exists, stored in its property's folder; its url goes into photo_urls. */
    uploadPhoto: (id: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch<UploadResult>(`/me/properties/${encodeURIComponent(id)}/photos`, {
        method: 'POST',
        formData: form,
      });
    },

    // Public marketplace. A signed-in member's token gets the street address;
    // signed out (or with a token the API refuses) the address is the suburb only.
    listPublic: (filters: PropertyFilters = {}) =>
      apiFetch<Property[]>('/properties', { query: filters }),
    getPublic: (id: string) =>
      apiFetch<Property>(`/properties/${encodeURIComponent(id)}`),
    /** Tenants only; both answer the like and the listing's new count. */
    like: (id: string) =>
      apiFetch<{ liked: boolean; like_count: number }>(`/properties/${encodeURIComponent(id)}/like`, { method: 'PUT' }),
    unlike: (id: string) =>
      apiFetch<{ liked: boolean; like_count: number }>(`/properties/${encodeURIComponent(id)}/like`, { method: 'DELETE' }),

    /** Amenity vocabulary, aggregated from every listing in the database. */
    amenities: () => apiFetch<string[]>('/properties/amenities', { auth: false }),

    /** Signed in, the reviews also carry their photo links (lib/property-reviews.ts reads them). */
    reviews: (id: string) =>
      apiFetch<Review[]>(`/properties/${id}/reviews`),
    /** A listed home's open inspection times; booking and managing them is lib/inspections. */
    inspections: (id: string) =>
      apiFetch<Inspection[]>(`/properties/${id}/inspections`, { auth: false }),
  },

  applications: {
    // Tenant
    create: (payload: ApplicationInput) =>
      apiFetch<Application>('/applications', { method: 'POST', body: payload }),
    listMine: () => apiFetch<Application[]>('/applications'),
    withdraw: (id: string) =>
      apiFetch<void>(`/applications/${id}`, { method: 'DELETE' }),

    // Landlord
    listForProperty: (propertyId: string, status?: string) =>
      apiFetch<Application[]>(`/properties/${propertyId}/applications`, {
        query: { status },
      }),
    update: (
      id: string,
      payload: { status?: ApplicationStatus; shortlisted?: boolean; tenant_score?: number; note?: string | null },
    ) => apiFetch<Application>(`/applications/${id}`, { method: 'PATCH', body: payload }),
    /** A link to a document the applicant shares, signed for a few minutes. */
    documentLink: (applicationId: string, documentId: string) =>
      apiFetch<{ url: string; expires_in: number }>(
        `/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(documentId)}/link`,
      ),
  },

  categories: {
    list: () => apiFetch<Category[]>('/categories', { auth: false }),
    get: (slug: string) => apiFetch<Category>(`/categories/${slug}`, { auth: false }),
  },

  providers: {
    listPublic: (filters: ProviderFilters = {}) =>
      apiFetch<PublicProvider[]>('/providers', { auth: false, query: filters }),
    /** Accepts a UUID or the provider's URL slug. */
    getPublic: (idOrSlug: string) =>
      apiFetch<PublicProvider>(`/providers/${idOrSlug}`, { auth: false }),
    services: (providerId: string) =>
      apiFetch<ProviderService[]>(`/providers/${providerId}/services`, { auth: false }),
    reviews: (providerId: string) =>
      apiFetch<Review[]>(`/providers/${providerId}/reviews`, { auth: false }),
    busyTimes: (providerId: string) =>
      apiFetch<{date: string; start_time: string; end_time: string}[]>(`/providers/${providerId}/busy-times`, { auth: false }),
    availability: (providerId: string) =>
      apiFetch<Availability[]>(`/providers/${providerId}/availability`, { auth: false }),
    portfolio: (providerId: string) =>
      apiFetch<PortfolioItem[]>(`/providers/${providerId}/portfolio`, { auth: false }),

    // Signed-in provider ("me")
    mine: () => apiFetch<ServiceProvider>('/me/provider'),
    updateMine: (payload: Partial<ServiceProvider>) =>
      apiFetch<ServiceProvider>('/me/provider', { method: 'PATCH', body: payload }),
    createMine: (payload: { category: string } & Partial<ServiceProvider>) =>
      apiFetch<ServiceProvider>('/me/provider', { method: 'POST', body: payload }),
    myServices: () => apiFetch<ProviderService[]>('/me/services'),
    createService: (payload: ProviderServiceInput) =>
      apiFetch<ProviderService>('/me/services', { method: 'POST', body: payload }),
    updateService: (id: string, payload: Partial<ProviderServiceInput>) =>
      apiFetch<ProviderService>(`/me/services/${id}`, { method: 'PATCH', body: payload }),
    deleteService: (id: string) => apiFetch<void>(`/me/services/${id}`, { method: 'DELETE' }),
    myDocuments: () => apiFetch<VerificationDocument[]>('/me/verification-documents'),
    addDocument: (payload: {
      type: string;
      label?: string | null;
      document_url?: string | null;
    }) =>
      apiFetch<VerificationDocument>('/me/verification-documents', {
        method: 'POST',
        body: payload,
      }),
    updateDocument: (id: string, payload: { label?: string | null; document_url?: string | null }) =>
      apiFetch<VerificationDocument>(`/me/verification-documents/${id}`, { method: 'PATCH', body: payload }),
    deleteDocument: (id: string) =>
      apiFetch<void>(`/me/verification-documents/${id}`, { method: 'DELETE' }),
    myAvailability: () => apiFetch<Availability[]>('/me/availability'),
    createAvailability: (payload: {
      day_of_week: number;
      start_time: string;
      end_time: string;
      is_available?: boolean;
    }) => apiFetch<Availability>('/me/availability', { method: 'POST', body: payload }),
    updateAvailability: (
      id: string,
      payload: Partial<{
        day_of_week: number;
        start_time: string;
        end_time: string;
        is_available: boolean;
      }>,
    ) => apiFetch<Availability>(`/me/availability/${id}`, { method: 'PATCH', body: payload }),
    deleteAvailability: (id: string) =>
      apiFetch<void>(`/me/availability/${id}`, { method: 'DELETE' }),
    myReviews: () => apiFetch<Review[]>('/me/reviews'),
  },

  bookings: {
    list: (status?: string, scope?: 'client') => apiFetch<Booking[]>('/bookings', { query: { status, scope } }),
    get: (id: string) => apiFetch<Booking>(`/bookings/${id}`),
    create: (payload: {
      provider_id: string;
      service_id?: string | null;
      property_address?: string | null;
      property_suburb?: string | null;
      scheduled_date?: string | null;
      scheduled_time?: string | null;
      notes?: string | null;
    }) => apiFetch<Booking>('/bookings', { method: 'POST', body: payload }),
    update: (
      id: string,
      payload: {
        status?: BookingStatus;
        scheduled_date?: string | null;
        scheduled_time?: string | null;
        completion_report?: string | null;
        notes?: string | null;
      },
    ) => apiFetch<Booking>(`/bookings/${id}`, { method: 'PATCH', body: payload }),
  },

  reviews: {
    create: (payload: {
      booking_id?: string | null;
      property_id?: string | null;
      rating: number;
      comment?: string | null;
    }) => apiFetch<Review>('/reviews', { method: 'POST', body: payload }),
    forProperty: (propertyId: string) =>
      apiFetch<Review[]>(`/properties/${propertyId}/reviews`, { auth: false }),
    reply: (id: string, providerReply: string) =>
      apiFetch<Review>(`/reviews/${id}/reply`, {
        method: 'PATCH',
        body: { provider_reply: providerReply },
      }),
    flag: (id: string) => apiFetch<Review>(`/reviews/${id}/flag`, { method: 'PATCH' }),
  },

  complaints: {
    create: (payload: ComplaintInput) =>
      apiFetch<Complaint>('/complaints', { method: 'POST', body: payload }),
    /** Complaints I raised. */
    listMine: (status?: string) => apiFetch<Complaint[]>('/complaints', { query: { status } }),
    /** Complaints about me or a property I own. */
    listAgainstMe: (status?: string) =>
      apiFetch<Complaint[]>('/complaints/against-me', { query: { status } }),
    get: (id: string) => apiFetch<Complaint>(`/complaints/${id}`),
    update: (id: string, payload: Partial<ComplaintInput>) =>
      apiFetch<Complaint>(`/complaints/${id}`, { method: 'PATCH', body: payload }),
    respond: (id: string, response: string) =>
      apiFetch<Complaint>(`/complaints/${id}/respond`, { method: 'POST', body: { response } }),
    setStatus: (id: string, status: ComplaintStatus, resolutionNote?: string) =>
      apiFetch<Complaint>(`/complaints/${id}/status`, {
        method: 'PATCH',
        body: { status, resolution_note: resolutionNote ?? null },
      }),
  },

  uploads: {
    /** Multipart upload; the browser never touches Supabase Storage directly. */
    messageAttachment: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch<UploadResult>('/uploads/message-attachment', {
        method: 'POST',
        formData: form,
      });
    },
    verificationDocument: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch<UploadResult>('/uploads/verification-document', {
        method: 'POST',
        formData: form,
      });
    },
    /** A listing photo; its url is public and goes into PropertyInput.photo_urls. */
    propertyImage: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch<UploadResult>('/uploads/property-image', {
        method: 'POST',
        formData: form,
      });
    },
    /** Deletes a listing photo this owner uploaded that no listing shows, e.g. one taken out of the wizard. */
    discardPropertyImage: (url: string) =>
      apiFetch<void>('/uploads/property-image', { method: 'DELETE', query: { url } }),
  },

  conversations: {
    list: () => apiFetch<Conversation[]>('/conversations'),
    get: (id: string) => apiFetch<Conversation>(`/conversations/${id}`),
    messages: (id: string) => apiFetch<Message[]>(`/conversations/${id}/messages`),
    send: (id: string, body: string, attachmentUrl?: string) =>
      apiFetch<Message>(`/conversations/${id}/messages`, {
        method: 'POST',
        body: { body, attachment_url: attachmentUrl ?? null },
      }),
    markRead: (id: string) => apiFetch<void>(`/conversations/${id}/read`, { method: 'POST' }),
    startMarketplace: (payload: {
      provider_id: string;
      client_id?: string | null;
      booking_id?: string | null;
      subject?: string | null;
    }) => apiFetch<Conversation>('/conversations', { method: 'POST', body: payload }),
    startRental: (payload: {
      property_id?: string | null;
      // Tenants pass owner_id (or just property_id); landlords pass tenant_id.
      // Any role can pass peer_id for a connection-gated network DM.
      owner_id?: string | null;
      tenant_id?: string | null;
      peer_id?: string | null;
      subject?: string | null;
      body?: string | null;
    }) => apiFetch<Conversation>('/conversations/rental', { method: 'POST', body: payload }),
  },

  finance: {
    transactions: () => apiFetch<Transaction[]>('/me/transactions'),
    invoices: () => apiFetch<Invoice[]>('/me/invoices'),
    invoiceDocument: (id: string) => apiFetch<InvoiceDocument>(`/me/invoices/${id}/document`),
  },

  recommendations: {
    providerLocations: (filters: Pick<ProviderRecommendationFilters, 'role'> & { search?: string } = {}) =>
      apiFetch<{ items: ProviderRecommendationLocation[] }>('/me/recommendations/provider/locations', {
        query: { ...filters },
      }),
    provider: (filters: ProviderRecommendationFilters = {}) =>
      apiFetch<ProviderRecommendationsResponse>('/me/recommendations/provider', {
        query: { ...filters },
      }),
    analyzeProvider: (filters: ProviderRecommendationFilters = {}) =>
      apiFetch<ProviderRecommendationsResponse>('/me/recommendations/provider/analyze', {
        method: 'POST',
        body: filters,
      }),
    chat: (body: { messages: RecommendationChatMessage[]; criteria: RecommendationCriteria }) =>
      apiFetch<RecommendationChatResponse>('/me/recommendations/provider/chat', {
        method: 'POST',
        body,
      }),
  },

  connections: {
    list: (status?: ConnectionStatus) =>
      apiFetch<Connection[]>('/me/connections', { query: { status } }),
    request: (addresseeId: string) =>
      apiFetch<Connection>('/me/connections', {
        method: 'POST',
        body: { addressee_id: addresseeId },
      }),
    respond: (id: string, status: 'accepted' | 'declined') =>
      apiFetch<Connection>(`/me/connections/${id}`, { method: 'PATCH', body: { status } }),
    remove: (id: string) => apiFetch<void>(`/me/connections/${id}`, { method: 'DELETE' }),
  },

  subscriptions: {
    plans: (audience?: string) =>
      apiFetch<Plan[]>('/subscription-plans', { query: { audience } }),
    mine: () => apiFetch<Subscription | null>('/me/subscription'),
    select: (planId: string) =>
      apiFetch<Subscription>('/me/subscription', { method: 'PUT', body: { plan_id: planId } }),
    cancel: () => apiFetch<Subscription>('/me/subscription', { method: 'DELETE' }),
  },

  content: {
    faqs: (audience?: string) => apiFetch<Faq[]>('/faqs', { auth: false, query: { audience } }),
    supportContact: () => apiFetch<SupportContact>('/support-contact', { auth: false }),
    platformStats: () => apiFetch<PlatformStats>('/stats/platform', { auth: false }),
  },

  notifications: {
    list: (unreadOnly = false, limit = 50) =>
      apiFetch<NotificationItem[]>('/me/notifications', {
        query: { unread_only: unreadOnly, limit },
      }),
    markRead: (id: string) =>
      apiFetch<NotificationItem>(`/me/notifications/${id}/read`, { method: 'PATCH' }),
    markAllRead: () =>
      apiFetch<NotificationItem[]>('/me/notifications/read-all', { method: 'POST' }),
  },

  dashboard: {
    provider: () => apiFetch<ProviderDashboard>('/me/dashboard/provider'),
    providerFinance: () => apiFetch<ProviderFinance>('/me/dashboard/provider/finance'),
    owner: () => apiFetch<OwnerDashboard>('/me/dashboard/owner'),
    /** The counts OwnerShell shows on every page, without the rest of the dashboard. */
    ownerBadges: () => apiFetch<OwnerBadges>('/me/dashboard/owner/badges'),
    /** One listing's analytics over the last `days` days (lib/dashboards). */
    listing: (id: string, days: AnalyticsDays) =>
      apiFetch<ListingAnalytics>(`/me/dashboard/owner/properties/${encodeURIComponent(id)}`, { query: { days } }),
    tenant: () => apiFetch<TenantDashboard>('/me/dashboard/tenant'),
  },

  /** Where the signed-in account stands for the verification gates, read now (lib/account-standing). */
  account: {
    standing: () => apiFetch<AccountStandingOut>('/me/standing'),
  },

  /** A tenant's or landlord's place in their onboarding (lib/onboarding, R19). */
  onboarding: {
    get: () => apiFetch<OnboardingProgress>('/me/onboarding'),
    save: (step: string, completed = false) =>
      apiFetch<OnboardingProgress>('/me/onboarding', { method: 'PUT', body: { step, completed } }),
  },

  /** The owner AI assistant (lib/owner-assistant, R29-R31). */
  ownerAssistant: {
    workspace: () => apiFetch<OwnerAssistantWorkspace>('/me/owner-assistant'),
    /** requestId: the same id sent again gets the saved answer, so a retry asks nothing twice. */
    ask: (question: string, requestId?: string) =>
      apiFetch<OwnerAssistantAnswer>('/me/owner-assistant/messages', {
        method: 'POST',
        body: requestId ? { question, request_id: requestId } : { question },
      }),
    /** Runs the action that answer proposed, exactly as the server saved it. */
    confirm: (requestId: string) =>
      apiFetch<OwnerAssistantConfirmation>(`/me/owner-assistant/messages/${encodeURIComponent(requestId)}/confirm`, {
        method: 'POST',
      }),
  },

  maintenance: {
    list: (status?: string) => apiFetch<MaintenanceRequest[]>('/maintenance', { query: { status } }),
    create: (payload: {
      property_id: string;
      title: string;
      description: string;
      category?: string;
      priority?: string;
    }) => apiFetch<MaintenanceRequest>('/maintenance', { method: 'POST', body: payload }),
    setStatus: (id: string, status: string, resolutionNote?: string) =>
      apiFetch<MaintenanceRequest>(`/maintenance/${id}/status`, {
        method: 'PATCH',
        body: { status, resolution_note: resolutionNote ?? null },
      }),
    assign: (id: string, providerId: string) =>
      apiFetch<MaintenanceRequest>(`/maintenance/${id}/assign`, {
        method: 'POST',
        body: { provider_id: providerId },
      }),
  },
};
