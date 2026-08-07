// Thin typed client for the TenantVoice FastAPI backend.
// The frontend talks ONLY to this API (Supabase is backend-only). The backend
// hands us a Supabase-issued JWT at login/register; we keep it in a cookie so
// every subsequent request can send it as a Bearer token.
//
// There is no mock data anywhere in the frontend — every list, counter and
// label a screen renders comes back from one of the calls declared here.

import type { SessionRole } from '@/app/lib/session-role';
import { ROLE_COOKIE } from '@/app/lib/session-role';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

export const TOKEN_COOKIE = 'tv_token';

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
export function setAuthToken(token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_COOKIE, token);
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24}; SameSite=Lax`;
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromCookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TOKEN_COOKIE}=`));
  if (fromCookie) return decodeURIComponent(fromCookie.slice(TOKEN_COOKIE.length + 1));
  return localStorage.getItem(TOKEN_COOKIE);
}

export function clearAuthToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_COOKIE);
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/** Persist both the JWT and the UI role cookie after a successful auth. */
export function setAuthSession(token: string, role: SessionRole) {
  setAuthToken(token);
  if (typeof window === 'undefined') return;
  localStorage.setItem('tv_role', role);
  document.cookie = `${ROLE_COOKIE}=${encodeURIComponent(role)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
}

export function clearAuthSession() {
  clearAuthToken();
  if (typeof window === 'undefined') return;
  localStorage.removeItem('tv_role');
  document.cookie = `${ROLE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

type FetchOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean; // attach bearer token (default true)
  token?: string; // explicit token (server-side callers)
  query?: Record<string, string | number | boolean | undefined | null>;
};

function buildQuery(query?: FetchOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, token, query } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const bearer = token ?? (auth ? getAuthToken() : null);
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;

  const res = await fetch(`${API_BASE}${path}${buildQuery(query)}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

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
    throw new ApiError(res.status, extractError(data) ?? `Request failed (${res.status})`);
  }

  return data as T;
}

function extractError(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === 'string') return data;
  if (typeof data === 'object' && data !== null && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    // FastAPI validation errors: [{ loc, msg, type }]
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
  }
  return null;
}

/** Small helper for read-only screens: resolve to a fallback instead of throwing. */
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
  rating_avg: number;
  review_count: number;
  created_at: string;
  updated_at: string;
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

export type ApplicationStatus = 'new' | 'reviewing' | 'approved' | 'declined';

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
  // Present only on landlord-facing responses (list-for-property / update).
  tenant_name?: string | null;
  tenant_phone?: string | null;
};

export type ApplicationInput = {
  property_id: string;
  annual_income?: number | null;
  move_in_date?: string | null;
  rent_offered?: number | null;
  has_pets?: boolean;
  message?: string | null;
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
  category: string;
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
  pricing_type?: string;
  price: number;
  duration_minutes?: number | null;
  inclusions?: string | null;
  exclusions?: string | null;
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
};

export type Review = {
  id: string;
  booking_id: string | null;
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
  yoy_change_pct: number | null;
  monthly: MonthlyPoint[];
};

export type OwnerDashboard = {
  property_count: number;
  available_count: number;
  rented_count: number;
  application_count: number;
  new_application_count: number;
  active_lease_count: number;
  unread_messages: number;
  pending_connections: number;
  unread_notifications: number;
};

// ---------------------------------------------------------------------------
// Typed API surface
// ---------------------------------------------------------------------------
export const api = {
  auth: {
    register: (payload: {
      email: string;
      password: string;
      full_name: string;
      role: BackendRole;
    }) => apiFetch<AuthResponse>('/auth/register', { method: 'POST', body: payload, auth: false }),
    login: (payload: { email: string; password: string }) =>
      apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: payload, auth: false }),
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
    update: (id: string, payload: Partial<PropertyInput>) =>
      apiFetch<Property>(`/me/properties/${id}`, { method: 'PATCH', body: payload }),
    remove: (id: string) =>
      apiFetch<void>(`/me/properties/${id}`, { method: 'DELETE' }),

    // Public marketplace
    listPublic: (filters: PropertyFilters = {}) =>
      apiFetch<Property[]>('/properties', { auth: false, query: filters }),
    getPublic: (id: string) =>
      apiFetch<Property>(`/properties/${id}`, { auth: false }),

    /** Amenity vocabulary, aggregated from every listing in the database. */
    amenities: () => apiFetch<string[]>('/properties/amenities', { auth: false }),

    inspections: (id: string) =>
      apiFetch<Inspection[]>(`/properties/${id}/inspections`, { auth: false }),
    addInspection: (
      id: string,
      payload: { starts_at: string; duration_minutes?: number; capacity?: number | null },
    ) =>
      apiFetch<Inspection>(`/me/properties/${id}/inspections`, { method: 'POST', body: payload }),
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
      payload: { status?: ApplicationStatus; shortlisted?: boolean; tenant_score?: number },
    ) => apiFetch<Application>(`/applications/${id}`, { method: 'PATCH', body: payload }),
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
    addDocument: (payload: { type: string; label?: string | null }) =>
      apiFetch<VerificationDocument>('/me/verification-documents', {
        method: 'POST',
        body: payload,
      }),
    myAvailability: () => apiFetch<Availability[]>('/me/availability'),
    myReviews: () => apiFetch<Review[]>('/me/reviews'),
  },

  bookings: {
    list: (status?: string) => apiFetch<Booking[]>('/bookings', { query: { status } }),
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
    create: (payload: { booking_id: string; rating: number; comment?: string | null }) =>
      apiFetch<Review>('/reviews', { method: 'POST', body: payload }),
    reply: (id: string, providerReply: string) =>
      apiFetch<Review>(`/reviews/${id}/reply`, {
        method: 'PATCH',
        body: { provider_reply: providerReply },
      }),
    flag: (id: string) => apiFetch<Review>(`/reviews/${id}/flag`, { method: 'PATCH' }),
  },

  conversations: {
    list: () => apiFetch<Conversation[]>('/conversations'),
    get: (id: string) => apiFetch<Conversation>(`/conversations/${id}`),
    messages: (id: string) => apiFetch<Message[]>(`/conversations/${id}/messages`),
    send: (id: string, body: string) =>
      apiFetch<Message>(`/conversations/${id}/messages`, { method: 'POST', body: { body } }),
    markRead: (id: string) => apiFetch<void>(`/conversations/${id}/read`, { method: 'POST' }),
    startMarketplace: (payload: {
      provider_id: string;
      booking_id?: string | null;
      subject?: string | null;
    }) => apiFetch<Conversation>('/conversations', { method: 'POST', body: payload }),
    startRental: (payload: {
      property_id?: string | null;
      owner_id?: string | null;
      subject?: string | null;
      body?: string | null;
    }) => apiFetch<Conversation>('/conversations/rental', { method: 'POST', body: payload }),
  },

  finance: {
    transactions: () => apiFetch<Transaction[]>('/me/transactions'),
    invoices: () => apiFetch<Invoice[]>('/me/invoices'),
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
  },
};
