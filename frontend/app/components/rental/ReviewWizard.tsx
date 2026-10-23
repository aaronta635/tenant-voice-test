'use client';

// The tenant's property review (tracker R12), after the quick-review
// reference: three steps that keep their answers, each checked before the
// next. It is saved by the shared database's mobile_submit_review, which
// checks it all again: the 8 ratings, the text, the details and up to 4
// photos, sent together so a review that fails leaves no photo behind.

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import {
  BODY_MAX,
  DETAIL_MAX,
  ISSUES,
  MAX_PHOTOS,
  PHOTO_TYPES,
  RATING_WORDS,
  RESOLUTIONS,
  REVIEW_CATEGORIES,
  TITLE_MAX,
  issueLine,
  photoProblem,
  propertyReviewsApi,
  type Issue,
  type PropertyReview,
  type PropertyReviewInput,
  type Resolution,
  type ReviewCategory,
  type ReviewableHome,
} from '@/app/lib/property-reviews';

/** The steps the tenant screens open the wizard at; each lands on the step that now holds it. */
export type ReviewWizardStep = 'property' | 'tenancy' | 'ratings' | 'details' | 'photos' | 'financial' | 'submit';

const STEPS = [
  { title: 'Rate your experience', intro: 'Choose the home, then score each part of renting it from 1 (poor) to 5 (excellent).' },
  { title: 'Details & disclosure', intro: 'Tell future tenants about the problems you had and how they were raised with you.' },
  { title: 'Your review', intro: 'Say how each problem was handled, write your review and check it before you publish it.' },
] as const;
// Cost and value is one of the ratings; the tenancy is confirmed, and the review written, at the end.
const STEP_OF: Record<ReviewWizardStep, number> = {
  property: 0, ratings: 0, financial: 0, tenancy: 2, details: 2, photos: 2, submit: 2,
};

type Homes = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; items: ReviewableHome[] };
type Photo = { file: File; url: string | null };
type YesNo = boolean | null;

const field = 'mt-1.5 w-full rounded-lg border border-control-border bg-white px-3 py-2.5 text-sm text-text-dark focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-strong';
const label = 'block text-sm font-semibold text-text-dark';
const help = 'mt-1 text-xs text-text-body';

function previewUrl(file: File): string | null {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
}

function releasePreview(photo: Photo) {
  if (photo.url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(photo.url);
}

/** The listing or property the page was opened for (?property=), to choose it when it can be reviewed. */
function requestedHome(): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location?.search ?? '').get('property');
}

export default function ReviewWizard({ initialStep = 'property' }: { initialStep?: ReviewWizardStep }) {
  const id = useId();
  const [step, setStep] = useState(STEP_OF[initialStep] ?? 0);
  const [homes, setHomes] = useState<Homes>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Partial<Record<ReviewCategory, number>>>({});
  const [issues, setIssues] = useState<Issue[]>([]);
  const [noIssues, setNoIssues] = useState(false);
  const [resolutions, setResolutions] = useState<Partial<Record<Issue, Resolution>>>({});
  const [disclosed, setDisclosed] = useState<YesNo>(null);
  const [recommend, setRecommend] = useState<YesNo>(null);
  const [eviction, setEviction] = useState<YesNo>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pros, setPros] = useState('');
  const [cons, setCons] = useState('');
  const [advice, setAdvice] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [isTenant, setIsTenant] = useState(false);
  const [mayPublish, setMayPublish] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<PropertyReview | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef(photos);

  useEffect(() => {
    let active = true;
    propertyReviewsApi.homes().then(
      (items) => {
        if (!active) return;
        setHomes({ state: 'ready', items });
        const wanted = requestedHome();
        const chosen = items.find((home) => wanted && (home.listing_id === wanted || home.property_id === wanted))
          ?? (items.length === 1 ? items[0] : null);
        setPropertyId((current) => current && items.some((home) => home.property_id === current) ? current : chosen?.property_id ?? null);
      },
      (error) => {
        if (active) setHomes({ state: 'error', message: error instanceof ApiError ? error.message : 'Please try again.' });
      },
    );
    return () => { active = false; };
  }, [attempt]);

  // Previews are released when the wizard goes.
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => photosRef.current.forEach(releasePreview), []);

  const items = homes.state === 'ready' ? homes.items : [];
  const home = items.find((item) => item.property_id === propertyId) ?? null;
  const unrated = REVIEW_CATEGORIES.filter(({ key }) => !ratings[key]).length;
  const average = unrated < REVIEW_CATEGORIES.length
    ? (Object.values(ratings).reduce((sum, value) => sum + (value ?? 0), 0) / (REVIEW_CATEGORIES.length - unrated)).toFixed(1)
    : null;

  function problemsAt(index: number): string | null {
    if (index === 0) {
      if (!home) return 'Choose the home you are reviewing.';
      if (unrated) return `Rate every category: ${unrated} of ${REVIEW_CATEGORIES.length} still need a score.`;
    }
    if (index === 2) {
      if (!body.trim()) return 'Write your review: share your overall experience.';
      if (body.trim().length > BODY_MAX) return `Your review can be up to ${BODY_MAX} characters.`;
      if (title.trim().length > TITLE_MAX) return `The title can be up to ${TITLE_MAX} characters.`;
      if ([pros, cons, advice].some((text) => text.trim().length > DETAIL_MAX)) {
        return `Pros, cons and advice can be up to ${DETAIL_MAX} characters each.`;
      }
      if (!isTenant || !mayPublish) return 'Tick both confirmations to publish your review.';
    }
    return null;
  }

  function show(message: string | null) {
    setProblem(message);
    if (message) requestAnimationFrame(() => problemRef.current?.focus());
  }

  function goTo(index: number) {
    setStep(index);
    setProblem(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function next() {
    const found = problemsAt(step);
    if (found) show(found);
    else goTo(step + 1);
  }

  function toggleIssue(issue: Issue) {
    setNoIssues(false);
    setIssues((current) => current.includes(issue) ? current.filter((item) => item !== issue) : [...current, issue]);
  }

  function chooseNoIssues() {
    setNoIssues((current) => !current);
    setIssues([]);
  }

  function addPhotos(files: FileList | File[] | null) {
    const chosen = Array.from(files ?? []);
    const notes: string[] = [];
    const accepted: Photo[] = [];
    for (const file of chosen) {
      const reason = photoProblem(file);
      if (reason) notes.push(reason);
      else if (photos.length + accepted.length >= MAX_PHOTOS) notes.push(`You can add up to ${MAX_PHOTOS} photos.`);
      else accepted.push({ file, url: previewUrl(file) });
    }
    setPhotos((current) => [...current, ...accepted]);
    setPhotoNote([...new Set(notes)].join(' ') || null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const gone = current[index];
      if (gone) releasePreview(gone);
      return current.filter((_, position) => position !== index);
    });
    setPhotoNote(null);
  }

  function reviewInput(): PropertyReviewInput {
    return {
      ratings: Object.fromEntries(REVIEW_CATEGORIES.map(({ key }) => [key, ratings[key] ?? 0])) as PropertyReviewInput['ratings'],
      title: title.trim(),
      body: body.trim(),
      details: {
        pros: pros.trim() || null,
        cons: cons.trim() || null,
        advice_to_owner: advice.trim() || null,
        would_recommend: recommend,
        issues_disclosed: disclosed,
        maintenance_or_eviction_issue: eviction,
        reported_issues: issues.map((issue) => issueLine(issue, resolutions[issue])),
      },
    };
  }

  async function submit() {
    for (const index of [0, 2]) {
      const found = problemsAt(index);
      if (found) {
        if (index !== step) setStep(index);
        show(found);
        return;
      }
    }
    if (!home) return;
    setSubmitting(true);
    setProblem(null);
    try {
      const review = await propertyReviewsApi.submit(home.property_id, reviewInput(), photos.map((photo) => photo.file));
      photos.forEach(releasePreview);
      setPhotos([]);
      setSaved(review);
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (error) {
      show(error instanceof ApiError ? error.message : 'Your review was not sent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (homes.state === 'loading') {
    return <p role="status" className="text-sm text-text-body">Loading the homes you can review…</p>;
  }
  if (homes.state === 'error') {
    return (
      <section className="mx-auto max-w-xl rounded-2xl border border-border bg-white p-6 text-center" aria-labelledby={`${id}-error`}>
        <h2 id={`${id}-error`} className="font-heading text-h4 font-semibold text-text-dark">Couldn&apos;t load your homes</h2>
        <p className="mt-2 text-sm text-text-body">{homes.message}</p>
        <Button variant="secondary" className="mt-4" onClick={() => { setHomes({ state: 'loading' }); setAttempt((value) => value + 1); }}>
          Try again
        </Button>
      </section>
    );
  }
  if (saved) {
    return <Saved review={saved} home={home} headingRef={headingRef} />;
  }
  if (items.length === 0) {
    return (
      <section className="mx-auto max-w-xl rounded-2xl border border-border bg-white p-6 text-center" aria-labelledby={`${id}-empty`}>
        <h2 id={`${id}-empty`} className="font-heading text-h4 font-semibold text-text-dark">Nothing to review yet</h2>
        <p className="mt-2 text-sm text-text-body">
          You can review a home once one of your applications for it is approved, once per home.
        </p>
        <ButtonLink href="/tenant/applications" variant="secondary" className="mt-4">See your applications</ButtonLink>
      </section>
    );
  }

  const percent = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl">
      <div className="rounded-2xl border border-border bg-white">
        <div className="border-b border-border p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary-strong">Step {step + 1} of {STEPS.length}</p>
            <p className="text-xs font-semibold text-primary-strong">{percent}% done</p>
          </div>
          <h2 ref={headingRef} tabIndex={-1} className="mt-1 font-heading text-h3 font-semibold text-text-dark focus:outline-none">
            {STEPS[step].title}
          </h2>
          <p className="mt-1 text-sm text-text-body">{STEPS[step].intro}</p>
          <div aria-hidden className="mt-4 h-1.5 rounded-full bg-surface">
            <div className="h-full rounded-full bg-primary-strong transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>

        <div className="space-y-6 p-5 sm:p-6">
          <div ref={problemRef} tabIndex={-1} className="focus:outline-none">
            <FormMessage error={problem} />
          </div>

          {step === 0 ? (
            <>
              <div role="group" aria-labelledby={`${id}-homes`} className="min-w-0">
                <p id={`${id}-homes`} className={label}>Which home are you reviewing?</p>
                <div className="mt-2 grid gap-3">
                  {items.map((item) => {
                    const chosen = item.property_id === propertyId;
                    return (
                      <button
                        key={item.property_id}
                        type="button"
                        aria-pressed={chosen}
                        onClick={() => setPropertyId(item.property_id)}
                        className={`flex min-h-11 w-full items-start gap-3 rounded-xl border p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong ${chosen ? 'border-primary-strong bg-surface' : 'border-control-border bg-white hover:bg-surface'}`}
                      >
                        <span aria-hidden className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${chosen ? 'border-primary-strong' : 'border-control-border'}`}>
                          {chosen ? <span className="size-2.5 rounded-full bg-primary-strong" /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block break-words font-semibold text-text-dark">{item.name}</span>
                          <span className="block break-words text-sm text-text-body">
                            {[item.address, item.property_type].filter(Boolean).join(' · ') || 'Address not given'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="font-heading text-h4 font-semibold text-text-dark">Core ratings</h3>
                <p className={help}>All eight are needed. 1 is poor, 5 is excellent.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {REVIEW_CATEGORIES.map((category) => (
                    <RatingGroup
                      key={category.key}
                      name={`${id}-${category.key}`}
                      label={category.label}
                      hint={category.hint}
                      value={ratings[category.key] ?? null}
                      onChange={(value) => setRatings((current) => ({ ...current, [category.key]: value }))}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <div role="group" aria-labelledby={`${id}-issues`} className="min-w-0">
                <p id={`${id}-issues`} className={label}>Which problems did you have?</p>
                <p className={help}>Pick any that apply. You say how each was handled in the next step.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ISSUES.map((issue) => (
                    <Pill key={issue} pressed={issues.includes(issue)} onClick={() => toggleIssue(issue)}>{issue}</Pill>
                  ))}
                  <Pill pressed={noIssues} onClick={chooseNoIssues}>None</Pill>
                </div>
              </div>
              <YesNoGroup
                legend="Were known problems disclosed before you signed the lease?"
                value={disclosed}
                onChange={setDisclosed}
              />
              <YesNoGroup
                legend="Would you recommend this home to other tenants?"
                value={recommend}
                onChange={setRecommend}
                labels={['Yes, I would', 'No, I wouldn’t']}
              />
              <div className="rounded-xl border border-warning bg-white p-4">
                <YesNoGroup
                  legend="Did you leave because the landlord or agent asked you to go after you asked for repairs?"
                  value={eviction}
                  onChange={setEviction}
                />
                <p className="mt-2 text-sm font-semibold text-warning">Who sees this answer</p>
                <p className="text-sm text-text-body">
                  On this website, only you and the TenantVoice moderators see it, and it is never shown on the listing.
                  In the TenantVoice app, signed-in members, the home&apos;s owner included, can see it with your review
                  and your name. Answering is optional.
                </p>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              {issues.length ? (
                <div>
                  <h3 className="font-heading text-h4 font-semibold text-text-dark">How was each problem handled?</h3>
                  <div className="mt-3 space-y-3">
                    {issues.map((issue) => (
                      <div key={issue} role="group" aria-labelledby={`${id}-fixed-${issue}`} className="min-w-0">
                        <p id={`${id}-fixed-${issue}`} className="text-sm font-semibold text-text-dark">{issue}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {RESOLUTIONS.map((option) => (
                            <Pill
                              key={option.key}
                              pressed={resolutions[issue] === option.key}
                              label={`${issue}: ${option.label}`}
                              onClick={() => setResolutions((current) => ({ ...current, [issue]: option.key }))}
                            >
                              {option.label}
                            </Pill>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <TextField id={`${id}-title`} label="Title" optional value={title} onChange={setTitle} max={TITLE_MAX}
                placeholder="Sum it up in a few words" />
              <TextField id={`${id}-body`} label="Your review" value={body} onChange={setBody} max={BODY_MAX} rows={6}
                placeholder="What should the next tenant know about living here and renting from this landlord?" />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField id={`${id}-pros`} label="Pros" optional value={pros} onChange={setPros} max={DETAIL_MAX} rows={3} />
                <TextField id={`${id}-cons`} label="Cons" optional value={cons} onChange={setCons} max={DETAIL_MAX} rows={3} />
              </div>
              <TextField id={`${id}-advice`} label="Advice to the landlord" optional value={advice} onChange={setAdvice}
                max={DETAIL_MAX} rows={3} />

              <div>
                <h3 className="font-heading text-h4 font-semibold text-text-dark">Photos</h3>
                <p className={help}>
                  Up to {MAX_PHOTOS}: JPEG, PNG or WebP, 5 MB each. Signed-in members see them with your review.
                  A photo&apos;s link carries your account&apos;s ID, so a member who opens one could find your
                  public profile.
                </p>
                <input
                  ref={fileRef}
                  id={`${id}-photos`}
                  type="file"
                  accept={PHOTO_TYPES.join(',')}
                  multiple
                  className="sr-only"
                  aria-label="Add photos"
                  onChange={(event) => addPhotos(event.target.files)}
                />
                <div className="mt-3 flex flex-wrap gap-3">
                  {photos.map((photo, index) => (
                    <div key={`${photo.file.name}-${index}`} className="relative size-24 overflow-hidden rounded-xl border border-border bg-surface">
                      {photo.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo.url} alt={`Photo ${index + 1}: ${photo.file.name}`} className="size-full object-cover" />
                      ) : (
                        <span className="block break-all p-2 text-xs text-text-body">{photo.file.name}</span>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove photo ${index + 1}`}
                        onClick={() => removePhoto(index)}
                        className="absolute right-1 top-1 inline-flex size-8 items-center justify-center rounded-full bg-navy text-sm text-white"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {photos.length < MAX_PHOTOS ? (
                    <Button variant="secondary" className="size-24 rounded-xl" onClick={() => fileRef.current?.click()}>
                      Add photos
                    </Button>
                  ) : null}
                </div>
                {photoNote ? <p role="alert" className="mt-2 text-sm text-danger">{photoNote}</p> : null}
              </div>

              <dl className="grid gap-x-6 gap-y-2 rounded-xl bg-surface p-4 text-sm sm:grid-cols-2">
                <Summary term="Home" value={home?.name ?? '—'} />
                <Summary term="Average score" value={average ? `${average} out of 5` : '—'} />
                <Summary term="Would recommend" value={recommend === null ? 'Not answered' : recommend ? 'Yes' : 'No'} />
                <Summary term="Problems" value={issues.length ? issues.join(', ') : noIssues ? 'None' : 'Not answered'} />
                <Summary term="Photos" value={String(photos.length)} />
              </dl>

              <div className="space-y-3">
                <Check checked={isTenant} onChange={setIsTenant}>I am a current or past tenant of this home.</Check>
                <Check checked={mayPublish} onChange={setMayPublish}>
                  I understand that on this website my review is published on the listing as a &ldquo;Verified tenant&rdquo;,
                  without my name, and that in the TenantVoice app signed-in members, the home&apos;s owner included, can see
                  it with my name and any answer I gave about leaving after asking for repairs. Moderators may check
                  it.{photos.length
                    ? ' Signed-in members who open my photos could find my profile from their links.'
                    : ''}
                </Check>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-5 sm:p-6">
          <Button variant="ghost" onClick={() => goTo(Math.max(step - 1, 0))} disabled={step === 0 || submitting}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next}>Next</Button>
          ) : (
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? 'Publishing…' : 'Publish review'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function RatingGroup({ name, label: text, hint, value, onChange }: {
  name: string; label: string; hint: string; value: number | null; onChange: (value: number) => void;
}) {
  return (
    <div role="group" aria-labelledby={`${name}-label`} aria-describedby={`${name}-hint`}
      className="min-w-0 rounded-xl border border-border p-3 sm:p-4">
      <p id={`${name}-label`} className="text-sm font-semibold text-text-dark">{text}</p>
      <p id={`${name}-hint`} className="text-xs text-text-body">{hint}</p>
      {/* Five columns: the scale stays on one row from 320px up, each button as wide as the row allows. */}
      <div className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-2">
        {[1, 2, 3, 4, 5].map((score) => {
          const filled = value !== null && score <= value;
          return (
            <button
              key={score}
              type="button"
              aria-pressed={value === score}
              aria-label={`${text}: ${score} of 5, ${RATING_WORDS[score]}`}
              onClick={() => onChange(score)}
              className={`inline-flex h-11 w-full min-w-0 items-center justify-center rounded-lg border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong ${filled ? 'border-primary-strong bg-primary-strong text-white' : 'border-control-border bg-white text-text-dark hover:bg-surface'}`}
            >
              {score}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-text-body" aria-live="polite">{value ? `${value} of 5 · ${RATING_WORDS[value]}` : 'Not rated yet'}</p>
    </div>
  );
}

function Pill({ pressed, onClick, children, label: name }: {
  pressed: boolean; onClick: () => void; children: ReactNode; label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={name}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong ${pressed ? 'border-primary-strong bg-primary-strong text-white' : 'border-control-border bg-white text-text-dark hover:bg-surface'}`}
    >
      {children}
    </button>
  );
}

function YesNoGroup({ legend, value, onChange, labels = ['Yes', 'No'] }: {
  legend: string; value: YesNo; onChange: (value: boolean) => void; labels?: [string, string];
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="min-w-0">
      <p id={id} className={label}>{legend}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {([true, false] as const).map((answer, index) => (
          <Pill key={String(answer)} pressed={value === answer} onClick={() => onChange(answer)}>
            {labels[index]}
          </Pill>
        ))}
      </div>
    </div>
  );
}

function TextField({ id, label: text, value, onChange, max, rows, placeholder, optional = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void; max: number; rows?: number;
  placeholder?: string; optional?: boolean;
}) {
  const over = value.trim().length > max;
  const counter = `${id}-count`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={label}>
        {text}{optional ? <span className="font-normal text-text-body"> (optional)</span> : null}
      </label>
      {rows ? (
        <textarea id={id} rows={rows} value={value} placeholder={placeholder} aria-describedby={counter} aria-invalid={over || undefined}
          onChange={(event) => onChange(event.target.value)} className={`${field} resize-y`} />
      ) : (
        <input id={id} value={value} placeholder={placeholder} aria-describedby={counter} aria-invalid={over || undefined}
          onChange={(event) => onChange(event.target.value)} className={field} />
      )}
      <p id={counter} className={`mt-1 text-xs ${over ? 'font-semibold text-danger' : 'text-text-body'}`}>
        {value.trim().length} of {max} characters
      </p>
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-text-dark">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-primary-strong" />
      <span>{children}</span>
    </label>
  );
}

function Summary({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-text-body">{term}</dt>
      <dd className="break-words font-medium text-text-dark">{value}</dd>
    </div>
  );
}

function Saved({ review, home, headingRef }: {
  review: PropertyReview; home: ReviewableHome | null; headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <section className="mx-auto w-full min-w-0 max-w-3xl rounded-2xl border border-border bg-white p-5 sm:p-6" aria-labelledby="review-saved">
      <p role="status" className="text-sm font-semibold text-success">
        {review.status === 'PUBLISHED' ? 'Published' : 'Saved'}: your review is on the listing now.
      </p>
      <h2 id="review-saved" ref={headingRef} tabIndex={-1} className="mt-1 font-heading text-h3 font-semibold text-text-dark focus:outline-none">
        Thanks for reviewing {home?.name ?? 'your home'}
      </h2>
      <dl className="mt-4 grid gap-x-6 gap-y-2 rounded-xl bg-surface p-4 text-sm sm:grid-cols-2">
        <Summary term="Overall score" value={`${review.rating} out of 5`} />
        <Summary term="Landlord score" value={review.landlord_rating ? `${review.landlord_rating} out of 5` : '—'} />
        <Summary term="Status" value={review.status === 'PUBLISHED' ? 'Published' : review.status} />
        <Summary term="Photos" value={String(review.photo_count)} />
      </dl>
      {review.title ? <p className="mt-4 break-words font-semibold text-text-dark">{review.title}</p> : null}
      <p className="mt-1 whitespace-pre-line break-words text-sm text-text-body">{review.comment}</p>
      <p className="mt-4 text-sm text-text-body">
        On this website, your answer about leaving after asking for repairs stays with you and the moderators; in the
        TenantVoice app, signed-in members can see it with your name. You can&apos;t edit a review once it is published.
      </p>
      {home?.listing_id ? (
        <ButtonLink href={`/properties/${home.listing_id}`} variant="secondary" className="mt-4">See it on the listing</ButtonLink>
      ) : null}
    </section>
  );
}
