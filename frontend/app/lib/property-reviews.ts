// Structured property reviews (backend services/reviews.py, tracker R12): the
// shared database's mobile_submit_review keeps 8 category ratings, the text,
// the details and up to 4 photos; the property page reads the published ones.
// The server checks every limit again and says what is wrong.

import { api, apiFetch, type Review } from './api';

/** The 8 categories mobile_submit_review asks for, by their codes, in the form's order. */
export const REVIEW_CATEGORIES = [
  { key: 'conditionAtMoveIn', label: 'Condition at move-in', hint: 'Clean, safe and as advertised when you moved in.' },
  { key: 'maintenanceHandling', label: 'Maintenance handling', hint: 'How requests for repairs were handled.' },
  { key: 'ownerResponsiveness', label: 'Landlord responsiveness', hint: 'How quickly and clearly they replied.' },
  { key: 'repairQuality', label: 'Repair quality', hint: 'Whether repairs were done properly and lasted.' },
  { key: 'complianceFairness', label: 'Compliance & fairness', hint: 'Rules, bond and notices handled fairly.' },
  { key: 'safetyPrivacy', label: 'Safety & privacy', hint: 'Locks, safety features and respect for your privacy.' },
  { key: 'costValue', label: 'Cost & value', hint: 'What you got for the rent.' },
  { key: 'neighbourhood', label: 'Neighbourhood', hint: 'The street, transport and services nearby.' },
] as const;

export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number]['key'];
export type CategoryRatings = Partial<Record<ReviewCategory, number>>;

export const RATING_WORDS: Record<number, string> = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Excellent' };

// The function's limits, kept here so the form can say so before sending.
export const TITLE_MAX = 120;
export const BODY_MAX = 4000;
export const DETAIL_MAX = 1000;
export const ISSUE_MAX = 80;
export const REPORT_DETAILS_MAX = 500;
export const MAX_PHOTOS = 4;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** What the review-photos bucket takes that the server can check from a file's bytes. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const ISSUES = ['Mould', 'Plumbing', 'Electrical', 'Pests', 'Noise', 'Safety', 'Bond', 'Other'] as const;
export type Issue = (typeof ISSUES)[number];
export const RESOLUTIONS = [
  { key: 'day', label: 'Within a day', line: 'fixed within a day' },
  { key: 'days', label: '1–3 days', line: 'fixed in 1–3 days' },
  { key: 'week', label: '3–7 days', line: 'fixed in 3–7 days' },
  { key: 'weeks', label: 'Over a week', line: 'fixed after a week or more' },
  { key: 'never', label: 'Not fixed', line: 'not fixed' },
] as const;
export type Resolution = (typeof RESOLUTIONS)[number]['key'];

/** mobile_report_review's reasons. */
export const REPORT_REASONS = [
  { key: 'spam', label: 'Spam' },
  { key: 'misleading', label: 'Misleading information' },
  { key: 'offensive', label: 'Offensive content' },
  { key: 'hate', label: 'Hate speech or discrimination' },
  { key: 'privacy', label: 'Privacy violation' },
  { key: 'other', label: 'Other' },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['key'];

export type ReviewPhoto = { url: string; expires_in: number };

/** GET /properties/{id}/reviews: a published review as the viewer may read it. */
export type PropertyReview = Pick<Review, 'id' | 'provider_id' | 'rating' | 'comment' | 'provider_reply' | 'replied_at' | 'created_at' | 'client_name'> & {
  property_id: string | null;
  title: string | null;
  landlord_rating: number | null;
  ratings: CategoryRatings;
  pros: string | null;
  cons: string | null;
  advice_to_owner: string | null;
  would_recommend: boolean | null;
  issues_disclosed: boolean | null;
  reported_issues: string[];
  /** The private answer: null for anyone but its author and the admins. */
  maintenance_or_eviction_issue: boolean | null;
  photo_count: number;
  /** Only for a signed-in member. */
  photos: ReviewPhoto[];
  verified: boolean;
  status: string;
  mine: boolean;
  reported_by_me: boolean;
};

/** GET /me/reviewable-homes. */
export type ReviewableHome = {
  property_id: string;
  listing_id: string | null;
  name: string;
  address: string | null;
  property_type: string | null;
  image_url: string | null;
  rating: number;
  review_count: number;
};

export type PropertyReviewInput = {
  ratings: Record<ReviewCategory, number>;
  title: string;
  body: string;
  details: {
    pros: string | null;
    cons: string | null;
    advice_to_owner: string | null;
    would_recommend: boolean | null;
    issues_disclosed: boolean | null;
    maintenance_or_eviction_issue: boolean | null;
    reported_issues: string[];
  };
};

export const propertyReviewsApi = {
  homes: () => apiFetch<ReviewableHome[]>('/me/reviewable-homes'),
  /** The review and its photos in one request: the server stores the photos only for a review it saves. */
  submit: (propertyId: string, review: PropertyReviewInput, photos: File[]) => {
    const form = new FormData();
    form.append('review', JSON.stringify(review));
    for (const photo of photos) form.append('photos', photo);
    return apiFetch<PropertyReview>(`/properties/${encodeURIComponent(propertyId)}/reviews`, { method: 'POST', formData: form });
  },
  /** Signed in, the answer also carries photo links and the viewer's own private answer. */
  forProperty: (propertyId: string) => api.properties.reviews(propertyId) as unknown as Promise<PropertyReview[]>,
  report: (reviewId: string, reason: ReportReason, details: string) =>
    apiFetch<{ review_id: string; reason: string; reported_by_me: boolean }>(`/reviews/${encodeURIComponent(reviewId)}/reports`, {
      method: 'POST', body: { reason, details: details.trim() || null },
    }),
};

/** "Plumbing: fixed in 1–3 days", as reported_issues keeps it (at most 80 characters). */
export function issueLine(issue: string, resolution: Resolution | null | undefined): string {
  const fixed = RESOLUTIONS.find((option) => option.key === resolution);
  return (fixed ? `${issue}: ${fixed.line}` : issue).slice(0, ISSUE_MAX);
}

export type CategoryAverage = { key: ReviewCategory; label: string; average: number | null; count: number };

/** Each category's average over the reviews that scored it, to one decimal; null where none did. */
export function categoryAverages(reviews: Pick<PropertyReview, 'ratings'>[]): CategoryAverage[] {
  return REVIEW_CATEGORIES.map(({ key, label }) => {
    const scores = reviews.map((review) => review.ratings?.[key]).filter((score): score is number => typeof score === 'number');
    const average = scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10 : null;
    return { key, label, average, count: scores.length };
  });
}

/** The overall average of the reviews' scores, to one decimal; null without reviews. */
export function overallAverage(reviews: Pick<PropertyReview, 'rating'>[]): number | null {
  if (!reviews.length) return null;
  return Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10;
}

/** Why a chosen photo cannot be sent, or null when it can. */
export function photoProblem(file: Pick<File, 'type' | 'size' | 'name'>): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return `${file.name} is not a JPEG, PNG or WebP image.`;
  if (file.size > PHOTO_MAX_BYTES) return `${file.name} is over 5 MB.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}
