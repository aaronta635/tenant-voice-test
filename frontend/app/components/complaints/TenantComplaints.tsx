'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import Input from '@/app/components/ui/Input';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import ComplaintCard from '@/app/components/complaints/ComplaintCard';
import { api, ApiError, type Complaint } from '@/app/lib/api';
import {
  COMPLAINT_SEVERITY_OPTIONS,
  complaintCategoriesApi,
  DESCRIPTION_LIMITS,
  type ComplaintCategoryOption,
  type ComplaintSeverity,
  type ComplaintTenancy,
} from '@/app/lib/complaint-categories';

// One list as one load gave it: null items when it failed.
type Loaded = { attempt: number; items: Complaint[] | null; error: string | null };
// What the form needs, loaded together when it opens: null when it failed.
type FormChoices = { attempt: number; options: ComplaintCategoryOption[] | null; tenancies: ComplaintTenancy[] | null };

function loadError(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Please try again.';
}

/**
 * The tenant's complaints, each with its status and timeline, and the form
 * that lodges one about a rental they have an approved application for
 * (GET /complaints/tenancies), in one of the fixed categories
 * (GET /complaint-categories), with how serious it is. Complaints someone
 * lodged about the tenant are listed too, where the notices about them
 * link, with a way to respond. The two lists load, fail and retry on their own.
 */
export default function TenantComplaints() {
  const [mineAttempt, setMineAttempt] = useState(0);
  const [aboutAttempt, setAboutAttempt] = useState(0);
  const [mine, setMine] = useState<Loaded | null>(null);
  const [about, setAbout] = useState<Loaded | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [choicesAttempt, setChoicesAttempt] = useState(0);
  const [choices, setChoices] = useState<FormChoices | null>(null);

  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState<ComplaintSeverity>('MEDIUM');
  const [propertyId, setPropertyId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentMine = mine?.attempt === mineAttempt ? mine : null;
  const currentAbout = about?.attempt === aboutAttempt ? about : null;

  useEffect(() => {
    let cancelled = false;
    api.complaints.listMine().then(
      (items) => { if (!cancelled) setMine({ attempt: mineAttempt, items, error: null }); },
      (err) => { if (!cancelled) setMine({ attempt: mineAttempt, items: null, error: loadError(err) }); },
    );
    return () => { cancelled = true; };
  }, [mineAttempt]);

  useEffect(() => {
    let cancelled = false;
    api.complaints.listAgainstMe().then(
      (items) => { if (!cancelled) setAbout({ attempt: aboutAttempt, items, error: null }); },
      (err) => { if (!cancelled) setAbout({ attempt: aboutAttempt, items: null, error: loadError(err) }); },
    );
    return () => { cancelled = true; };
  }, [aboutAttempt]);

  useEffect(() => {
    if (!formOpen) return;
    let cancelled = false;
    // A complaint names a rental the tenant has an approved application for, as the database requires.
    Promise.allSettled([complaintCategoriesApi.list(), complaintCategoriesApi.tenancies()]).then(([found, rented]) => {
      if (cancelled) return;
      setChoices({
        attempt: choicesAttempt,
        options: found.status === 'fulfilled' ? found.value : null,
        tenancies: rented.status === 'fulfilled' ? rented.value : null,
      });
    });
    return () => { cancelled = true; };
  }, [formOpen, choicesAttempt]);

  const current = choices?.attempt === choicesAttempt ? choices : null;
  const options = current ? current.options : undefined;
  const tenancies = current ? current.tenancies : undefined;
  const chosen = options?.find((option) => option.code === category) ?? null;
  const length = description.trim().length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    if (!propertyId) {
      setError('Choose the rental this complaint is about.');
      return;
    }
    if (!chosen) {
      setError('Choose the category that fits best.');
      return;
    }
    if (length < DESCRIPTION_LIMITS.min || length > DESCRIPTION_LIMITS.max) {
      setError(`Describe what happened in ${DESCRIPTION_LIMITS.min} to ${DESCRIPTION_LIMITS.max} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.complaints.create({
        subject: subject.trim(),
        description: description.trim(),
        category: chosen.code,
        severity,
        property_id: propertyId,
      });
      setMine((previous) => (previous?.items ? { ...previous, items: [created, ...previous.items] } : previous));
      setSubject('');
      setDescription('');
      setPropertyId('');
      setCategory('');
      setSeverity('MEDIUM');
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not lodge that complaint.');
    } finally {
      setSubmitting(false);
    }
  }

  function replace(updated: Complaint) {
    const swap = (previous: Loaded | null) => (previous?.items
      ? { ...previous, items: previous.items.map((c) => (c.id === updated.id ? updated : c)) }
      : previous);
    setMine(swap);
    setAbout(swap);
  }

  const aboutHeading = (
    <div>
      <h2 id="complaints-about-you" className="font-heading text-xl font-bold text-text-dark">
        Complaints about you
      </h2>
      <p className="mt-1 text-sm text-text-body">
        Someone lodged these about you. Respond to give your side; TenantVoice decides each one.
      </p>
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-[30px] font-bold tracking-tight text-text-dark">
            Complaints
          </h1>
          <p className="mt-1 text-text-body">
            A formal complaint is tracked to resolution — separate from a public review.
          </p>
        </div>
        <Button variant="primary" onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? 'Cancel' : 'Lodge a complaint'}
        </Button>
      </div>

      {formOpen ? (
        <Card className="rounded-[16px] border border-border p-6">
          <h2 className="font-heading text-lg font-bold text-text-dark">New complaint</h2>
          <form className="mt-4 flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-[6px]">
              <label
                htmlFor="complaint-property"
                className="text-[11px] font-semibold tracking-[0.8px] text-text-body uppercase"
              >
                Rental
              </label>
              {tenancies === undefined ? (
                <p role="status" className="text-sm text-text-body">Loading your rentals…</p>
              ) : tenancies === null ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p role="alert" className="text-sm text-danger">Your rentals could not be loaded.</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setChoicesAttempt((value) => value + 1)}>
                    Try again
                  </Button>
                </div>
              ) : tenancies.length === 0 ? (
                <p className="text-sm text-text-body">
                  You can lodge a complaint about a rental once an application of yours for it is approved.
                </p>
              ) : (
                <select
                  id="complaint-property"
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  required
                  className="h-11 w-full min-w-0 rounded border border-control-border bg-white px-3 text-sm text-text-dark focus:ring-2 focus:ring-primary focus:outline-none"
                >
                  <option value="">Select a rental…</option>
                  {tenancies.map((tenancy) => (
                    <option key={tenancy.listing_id} value={tenancy.listing_id}>
                      {tenancy.address ? `${tenancy.title} — ${tenancy.address}` : tenancy.title}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <fieldset className="flex flex-col gap-[6px]">
              <legend className="text-[11px] font-semibold tracking-[0.8px] text-text-body uppercase">
                Category
              </legend>
              {options === undefined ? (
                <p role="status" className="text-sm text-text-body">Loading the categories…</p>
              ) : options === null ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p role="alert" className="text-sm text-danger">The categories could not be loaded.</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setChoicesAttempt((value) => value + 1)}>
                    Try again
                  </Button>
                </div>
              ) : options.length === 0 ? (
                <p className="text-sm text-text-body">
                  No complaint categories are open right now. Contact TenantVoice support instead.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {options.map((item) => (
                      <button
                        key={item.code}
                        type="button"
                        aria-pressed={category === item.code}
                        onClick={() => setCategory(item.code)}
                        className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium ${
                          category === item.code
                            ? 'border-primary-strong bg-surface text-primary-strong'
                            : 'border-control-border bg-white text-text-body hover:border-primary-strong hover:text-primary-strong'
                        }`}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                  {chosen?.description ? <p className="text-sm text-text-body">{chosen.description}</p> : null}
                </>
              )}
            </fieldset>

            <div className="flex flex-col gap-[6px]">
              <label
                htmlFor="complaint-severity"
                className="text-[11px] font-semibold tracking-[0.8px] text-text-body uppercase"
              >
                How serious is it?
              </label>
              <select
                id="complaint-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as ComplaintSeverity)}
                className="h-11 w-full min-w-0 rounded border border-control-border bg-white px-3 text-sm text-text-dark focus:ring-2 focus:ring-primary focus:outline-none"
              >
                {COMPLAINT_SEVERITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label} — {option.hint}</option>
                ))}
              </select>
            </div>

            <Input
              label="Subject"
              placeholder="Short summary, e.g. Smoke alarm not working"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              minLength={3}
            />

            <div className="flex flex-col gap-[6px]">
              <label
                htmlFor="complaint-description"
                className="text-[11px] font-semibold tracking-[0.8px] text-text-body uppercase"
              >
                What happened?
              </label>
              <textarea
                id="complaint-description"
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                minLength={DESCRIPTION_LIMITS.min}
                maxLength={DESCRIPTION_LIMITS.max}
                aria-describedby="complaint-description-count"
                placeholder="Include dates, what you have already tried, and how it is affecting you."
                className="rounded border border-control-border bg-white p-3 text-sm text-text-dark placeholder:text-text-subtle focus:ring-2 focus:ring-primary focus:outline-none"
              />
              <p id="complaint-description-count" className="text-xs text-text-body">
                {length} of {DESCRIPTION_LIMITS.max} characters (at least {DESCRIPTION_LIMITS.min})
              </p>
            </div>

            {error ? (
              <p role="alert" className="rounded-xl border border-danger px-4 py-3 text-sm text-danger">
                {error}
              </p>
            ) : null}

            <p className="text-xs leading-relaxed text-text-body">
              The property owner can see and respond to this complaint, and TenantVoice
              updates its status. For urgent safety matters contact emergency services or NSW
              Fair Trading directly.
            </p>

            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={submitting || !options?.length || !tenancies?.length}>
                {submitting ? 'Submitting…' : 'Submit complaint'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {!currentMine ? (
        <p role="status" className="text-sm text-text-body">Loading complaints…</p>
      ) : !currentMine.items ? (
        <LoadErrorCard title="Couldn't load your complaints" message={currentMine.error ?? undefined} onRetry={() => setMineAttempt((value) => value + 1)} />
      ) : currentMine.items.length === 0 ? (
        <Card className="rounded-[16px] border border-border p-8 text-center">
          <h2 className="font-heading text-lg font-bold text-text-dark">No complaints raised</h2>
          <p className="mt-2 text-sm text-text-body">
            If something is wrong with your rental, lodging a complaint creates a tracked record.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {currentMine.items.map((complaint) => (
            <ComplaintCard
              key={complaint.id}
              complaint={complaint}
              perspective="mine"
              onChanged={replace}
            />
          ))}
        </div>
      )}

      {/* Complaints about the tenant load on their own: a failure here keeps the ones they raised. */}
      {!currentAbout ? (
        currentMine ? <p role="status" className="text-sm text-text-body">Checking for complaints about you…</p> : null
      ) : !currentAbout.items ? (
        <section aria-labelledby="complaints-about-you" className="flex flex-col gap-4">
          {aboutHeading}
          <LoadErrorCard
            title="Couldn't load the complaints about you"
            message={currentAbout.error ?? undefined}
            onRetry={() => setAboutAttempt((value) => value + 1)}
          />
        </section>
      ) : currentAbout.items.length > 0 ? (
        <section aria-labelledby="complaints-about-you" className="flex flex-col gap-4">
          {aboutHeading}
          {currentAbout.items.map((complaint) => (
            <ComplaintCard
              key={complaint.id}
              complaint={complaint}
              perspective="against"
              onChanged={replace}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
