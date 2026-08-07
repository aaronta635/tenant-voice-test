'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import {
  api,
  ApiError,
  safe,
  type Application,
  type Booking,
  type Profile,
  type Property,
} from '@/app/lib/api';
import { formatDate, formatMoney } from '@/app/lib/format';

export type ReviewWizardStep =
  | 'property'
  | 'tenancy'
  | 'ratings'
  | 'details'
  | 'photos'
  | 'financial'
  | 'submit';

type RatingKey = 'overall' | 'maintenance' | 'communication' | 'value';

const FALLBACK_IMAGE = '/tenant/application-modern-loft.png';

const steps: { id: ReviewWizardStep; label: string }[] = [
  { id: 'property', label: 'Property' },
  { id: 'tenancy', label: 'Tenancy' },
  { id: 'ratings', label: 'Ratings' },
  { id: 'details', label: 'Details' },
  { id: 'photos', label: 'Photos' },
  { id: 'financial', label: 'Financial' },
  { id: 'submit', label: 'Submit' },
];

const stepCopy: Record<ReviewWizardStep, string> = {
  property: 'Choose the rental connected to this review.',
  tenancy: 'Confirm tenancy details before writing publicly.',
  ratings: 'Score the parts of the rental experience.',
  details: 'Write a clear review for future tenants.',
  photos: 'Attach evidence photos for moderation.',
  financial: 'Add rent, bond, and pricing context.',
  submit: 'Preview the review before publishing.',
};

const ratingLabels: Record<RatingKey, string> = {
  overall: 'Overall',
  maintenance: 'Maintenance',
  communication: 'Communication',
  value: 'Value',
};

export default function ReviewWizard({
  initialStep = 'property',
}: {
  initialStep?: ReviewWizardStep;
}) {
  const initialIndex = Math.max(0, steps.findIndex((step) => step.id === initialStep));
  const [stepIndex, setStepIndex] = useState(initialIndex);

  const [properties, setProperties] = useState<Property[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<RatingKey, number>>({
    overall: 5,
    maintenance: 5,
    communication: 5,
    value: 5,
  });
  const [review, setReview] = useState('');
  const [photoCount, setPhotoCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [applicationList, me, bookingList] = await Promise.all([
        safe(api.applications.listMine(), []),
        safe<Profile | null>(api.profiles.me(), null),
        safe(api.bookings.list('completed'), []),
      ]);

      // Reviews attach to properties the tenant actually applied for; fall back
      // to the public marketplace so the flow is still demonstrable.
      const applied = await Promise.all(
        applicationList.map((app) => safe<Property | null>(api.properties.getPublic(app.property_id), null)),
      );
      let propertyList = applied.filter((p): p is Property => !!p);
      if (propertyList.length === 0) {
        propertyList = await safe(api.properties.listPublic({ limit: 6 }), []);
      }

      if (!active) return;
      setApplications(applicationList);
      setBookings(bookingList);
      setProfile(me);
      setProperties(propertyList);
      setPropertyId(propertyList[0]?.id ?? null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const activeStep = steps[stepIndex];
  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === propertyId) ?? null,
    [properties, propertyId],
  );
  const selectedApplication = useMemo(
    () => applications.find((app) => app.property_id === propertyId) ?? null,
    [applications, propertyId],
  );
  const averageRating = useMemo(() => {
    const values = Object.values(ratings);
    return (values.reduce((total, rating) => total + rating, 0) / values.length).toFixed(1);
  }, [ratings]);

  /**
   * A property review needs a completed booking to attach to (the reviews table
   * is keyed on booking_id). We use the tenant's most recent completed booking.
   */
  const reviewableBooking = bookings[0] ?? null;

  async function submitReview() {
    if (!reviewableBooking) {
      setError(
        'Reviews are published against a completed booking. Complete a booking first, then return here.',
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.reviews.create({
        booking_id: reviewableBooking.id,
        rating: Math.round(Number(averageRating)),
        comment: review,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit that review.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-[#565d6d]">Loading your review…</p>;

  if (properties.length === 0) {
    return (
      <div className="rounded-[12px] border border-[#dee1e6] bg-white p-8 text-center">
        <h2 className="font-heading text-xl font-semibold">Nothing to review yet</h2>
        <p className="mt-2 text-sm text-[#565d6d]">
          Apply for a property first — reviews attach to a rental you&apos;ve been connected to.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)_300px]">
      <aside className="h-fit rounded-[12px] border border-[#dee1e6] bg-white p-3">
        <div className="px-2 py-2">
          <p className="text-xs font-semibold uppercase text-[#565d6d]">Review steps</p>
          <div className="mt-3 h-1.5 rounded-full bg-[#e5e7eb]">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round(((stepIndex + 1) / steps.length) * 100)}%` }}
            />
          </div>
        </div>
        <div className="mt-2 space-y-1">
          {steps.map((step, index) => {
            const active = index === stepIndex;
            const done = index < stepIndex;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setStepIndex(index)}
                className={`flex h-11 w-full items-center gap-3 rounded-[8px] px-3 text-left text-sm transition ${
                  active
                    ? 'bg-[#f0f1ff] font-semibold text-primary'
                    : 'text-[#565d6d] hover:bg-[#f8f9fa] hover:text-[#171a1f]'
                }`}
              >
                <span
                  className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                    done ? 'bg-primary text-white' : active ? 'bg-white text-primary' : 'bg-[#f3f4f6] text-[#565d6d]'
                  }`}
                >
                  {done ? '✓' : index + 1}
                </span>
                {step.label}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="overflow-hidden rounded-[12px] border border-[#dee1e6] bg-white">
        <div className="border-b border-[#eef0f4] px-5 py-5">
          <p className="text-xs font-semibold uppercase text-primary">
            Step {stepIndex + 1} of {steps.length}
          </p>
          <h2 className="mt-1 font-heading text-2xl font-semibold text-[#171a1f]">
            {activeStep.label}
          </h2>
          <p className="mt-1 text-sm text-[#565d6d]">{stepCopy[activeStep.id]}</p>
        </div>

        <div className="min-h-[420px] p-5">
          {activeStep.id === 'property' ? (
            <div className="space-y-3">
              {properties.map((property) => {
                const selected = property.id === propertyId;
                return (
                  <button
                    key={property.id}
                    type="button"
                    onClick={() => setPropertyId(property.id)}
                    className={`flex w-full gap-4 rounded-[10px] border p-3 text-left transition ${
                      selected ? 'border-primary bg-[#f7f7ff]' : 'border-[#dee1e6] hover:border-primary/40'
                    }`}
                  >
                    <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-[8px]">
                      <Image
                        src={property.photo_urls?.[0] || FALLBACK_IMAGE}
                        alt=""
                        fill
                        sizes="96px"
                        className="object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-[#171a1f]">{property.title}</p>
                          <p className="mt-1 text-sm text-[#565d6d]">
                            {property.suburb ?? property.address}
                          </p>
                        </div>
                        <p className="font-heading text-lg font-semibold text-primary">
                          {formatMoney(property.price)}/wk
                        </p>
                      </div>
                      <p className="mt-2 text-xs text-[#565d6d]">{property.address}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}

          {activeStep.id === 'tenancy' ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Input
                label="Applied on"
                readOnly
                value={formatDate(selectedApplication?.created_at)}
                className="rounded-[8px] bg-white"
              />
              <Input
                label="Move-in date"
                readOnly
                value={formatDate(
                  selectedApplication?.move_in_date ?? selectedProperty?.available_from,
                )}
                className="rounded-[8px] bg-white"
              />
              <Input
                label="Lease holder"
                readOnly
                value={profile?.full_name ?? '—'}
                className="rounded-[8px] bg-white"
              />
              <Input
                label="Lease term"
                readOnly
                value={selectedProperty?.lease_term ?? '—'}
                className="rounded-[8px] bg-white"
              />
            </div>
          ) : null}

          {activeStep.id === 'ratings' ? (
            <div className="divide-y divide-[#eef0f4] rounded-[10px] border border-[#dee1e6]">
              {(Object.keys(ratingLabels) as RatingKey[]).map((key) => (
                <div
                  key={key}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold text-[#171a1f]">{ratingLabels[key]}</p>
                    <p className="mt-1 text-sm text-[#565d6d]">{ratings[key]} out of 5</p>
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setRatings({ ...ratings, [key]: value })}
                        className={`size-9 rounded-[6px] text-2xl leading-none transition ${
                          value <= ratings[key] ? 'text-[#f5a524]' : 'text-[#c9ced8] hover:bg-[#f8f9fa]'
                        }`}
                        aria-label={`${ratingLabels[key]} ${value} stars`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {activeStep.id === 'details' ? (
            <div>
              <label htmlFor="review-body" className="text-[11px] font-semibold uppercase text-[#565d6d]">
                Detailed review
              </label>
              <textarea
                id="review-body"
                value={review}
                onChange={(event) => setReview(event.target.value)}
                placeholder="What should future tenants know about this property and owner?"
                className="mt-[6px] min-h-[260px] w-full resize-none rounded-[8px] border border-[#dee1e6] bg-white p-4 text-sm leading-6 outline-none focus:border-transparent focus:ring-2 focus:ring-primary"
              />
              <p className="mt-2 text-xs text-[#565d6d]">{review.length} characters</p>
            </div>
          ) : null}

          {activeStep.id === 'photos' ? (
            <div className="space-y-4">
              <div className="rounded-[10px] border border-dashed border-[#b9bfcc] bg-[#fbfbfd] p-6">
                <p className="font-semibold text-[#171a1f]">Evidence photos</p>
                <p className="mt-1 text-sm text-[#565d6d]">
                  Attach photos that support the review. Uploads land with moderation.
                </p>
                <Button
                  className="mt-4 h-10 rounded-[8px]"
                  onClick={() => setPhotoCount((count) => count + 1)}
                >
                  Add Photo
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {Array.from({ length: photoCount }).map((_, index) => (
                  <div
                    key={index}
                    className="rounded-[8px] border border-[#dee1e6] bg-white p-3 text-sm font-medium"
                  >
                    Evidence photo {index + 1}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeStep.id === 'financial' ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Input
                label="Weekly rent"
                readOnly
                value={formatMoney(selectedProperty?.price)}
                className="rounded-[8px] bg-white"
              />
              <Input
                label="Bond"
                readOnly
                value={formatMoney(selectedProperty?.bond)}
                className="rounded-[8px] bg-white"
              />
              <Input
                label="Rent you offered"
                readOnly
                value={formatMoney(selectedApplication?.rent_offered)}
                className="rounded-[8px] bg-white"
              />
              <Input
                label="Listed amenities"
                readOnly
                value={(selectedProperty?.amenities ?? []).join(', ') || '—'}
                className="rounded-[8px] bg-white"
              />
            </div>
          ) : null}

          {activeStep.id === 'submit' ? (
            <div className="space-y-4">
              {submitted ? (
                <div className="rounded-[10px] border border-[#b7ebc6] bg-[#ecfdf3] p-4 text-sm text-[#1b7c4f]">
                  <span className="font-semibold">Review submitted.</span> It is now saved against
                  your booking.
                </div>
              ) : null}
              {error ? (
                <div className="rounded-[10px] border border-[#f3c6c6] bg-[#fdecee] p-4 text-sm text-[#a12b3b]">
                  {error}
                </div>
              ) : null}
              <div className="rounded-[10px] border border-[#dee1e6] p-4">
                <h3 className="font-heading text-xl font-semibold text-[#171a1f]">
                  {selectedProperty?.title ?? '—'}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#565d6d]">
                  {review || 'No written review yet.'}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <SummaryTile label="Overall" value={`${ratings.overall}/5`} />
                  <SummaryTile label="Communication" value={`${ratings.communication}/5`} />
                  <SummaryTile label="Photos" value={String(photoCount)} />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eef0f4] bg-[#fbfbfd] px-5 py-4">
          <Button
            variant="ghost"
            className="h-10 rounded-[8px]"
            onClick={() => setStepIndex((c) => Math.max(c - 1, 0))}
            disabled={stepIndex === 0}
          >
            Back
          </Button>
          <div className="flex gap-3">
            {activeStep.id === 'submit' ? (
              <Button
                className="h-10 rounded-[8px]"
                onClick={submitReview}
                disabled={submitting || submitted}
              >
                {submitting ? 'Submitting…' : submitted ? 'Submitted' : 'Submit Review'}
              </Button>
            ) : (
              <Button
                className="h-10 rounded-[8px]"
                onClick={() => setStepIndex((c) => Math.min(c + 1, steps.length - 1))}
              >
                Continue
              </Button>
            )}
          </div>
        </div>
      </section>

      <aside className="h-fit rounded-[12px] border border-[#dee1e6] bg-white p-4">
        <div className="relative h-32 overflow-hidden rounded-[8px]">
          <Image
            src={selectedProperty?.photo_urls?.[0] || FALLBACK_IMAGE}
            alt=""
            fill
            sizes="300px"
            className="object-cover"
          />
        </div>
        <h3 className="mt-4 font-heading text-lg font-semibold text-[#171a1f]">
          {selectedProperty?.title ?? '—'}
        </h3>
        <p className="mt-1 text-sm text-[#565d6d]">{selectedProperty?.address ?? ''}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <SummaryTile label="Average" value={averageRating} />
          <SummaryTile label="Photos" value={String(photoCount)} />
        </div>
        <dl className="mt-4 space-y-3 border-t border-[#eef0f4] pt-4 text-sm">
          <SummaryItem label="Rent" value={`${formatMoney(selectedProperty?.price)}/wk`} />
          <SummaryItem label="Bond" value={formatMoney(selectedProperty?.bond)} />
          <SummaryItem label="Status" value={submitted ? 'Submitted' : 'Draft'} />
        </dl>
      </aside>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[#565d6d]">{label}</dt>
      <dd className="font-semibold text-[#171a1f]">{value}</dd>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-[#f7f8fb] p-3 text-center">
      <p className="font-heading text-xl font-semibold text-primary">{value}</p>
      <p className="mt-1 text-xs font-medium text-[#565d6d]">{label}</p>
    </div>
  );
}
