'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import VerificationRequired from '@/app/components/trust/VerificationRequired';
import { api, ApiError, type Application } from '@/app/lib/api';
import { formatMoney } from '@/app/lib/format';
import {
  applicationInput,
  prefillApplication,
  type ApplicationDraft,
  type PrefilledFields,
} from '@/app/lib/listings';
import { getMyProfile, sydneyToday } from '@/app/lib/my-profile';
import { documentsApi, type ProfileDocument } from '@/app/lib/profile-documents';
import { verificationRequired, type VerificationRequiredDetail } from '@/app/lib/verification-gate';

type Props = {
  listing: { id: string; title: string; price: number };
  onSubmitted: (application: Application) => void;
  onCancel?: () => void;
  /** Told while the application is being sent, so a dialog around the form stays open. */
  onBusy?: (busy: boolean) => void;
};

type Loaded = { draft: ApplicationDraft; prefilled: PrefilledFields; profileFailed: boolean };

const DOCUMENT_STATUS: Record<ProfileDocument['status'], string> = {
  pending: 'In review',
  verified: 'Verified by TenantVoice',
  rejected: 'Not accepted',
};

const textArea =
  'w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark placeholder:text-text-subtle focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong';
const label = 'text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body';

/**
 * Apply for a listing (R25). The form starts from the tenant's saved profile
 * (move-in date, household size, pets, budget as the offer, about line), and
 * every field stays theirs to change before sending. Only documents they
 * marked shareable with landlords are offered, and only those they tick go.
 * Applying needs a verified account (R18): the server's refusal shows as
 * VerificationRequired, with the way to the tenant's documents.
 */
export default function ApplicationForm({ listing, onSubmitted, onCancel, onBusy }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<ApplicationDraft | null>(null);
  const [shareable, setShareable] = useState<ProfileDocument[] | null>(null);
  const [documentsFailed, setDocumentsFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<VerificationRequiredDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const today = sydneyToday();

  useEffect(() => {
    let active = true;
    (async () => {
      const [profile, checklist] = await Promise.allSettled([getMyProfile(), documentsApi.checklist()]);
      if (!active) return;
      // The form opens whatever either read gave: an unreadable profile fills nothing in.
      const saved = profile.status === 'fulfilled' && profile.value ? profile.value : null;
      const filled = prefillApplication(saved, listing.price);
      setLoaded({ ...filled, profileFailed: saved === null });
      setDraft(filled.draft);
      const documents = checklist.status === 'fulfilled' ? checklist.value?.documents : null;
      if (Array.isArray(documents)) {
        setShareable(documents.filter((doc) => doc.visibility === 'applications' && doc.has_file && doc.can_open));
      } else {
        setDocumentsFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [listing.price]);

  useEffect(() => {
    onBusy?.(submitting);
  }, [submitting, onBusy]);

  if (!loaded || !draft) {
    return <p role="status" className="text-sm text-text-body">Loading your saved profile…</p>;
  }

  function set<K extends keyof ApplicationDraft>(key: K, value: ApplicationDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function toggleDocument(documentId: string, checked: boolean) {
    setDraft((current) => current && {
      ...current,
      documentIds: checked
        ? [...current.documentIds, documentId]
        : current.documentIds.filter((value) => value !== documentId),
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || submitting) return;
    const result = applicationInput(listing.id, draft, today);
    if ('error' in result) {
      setError(result.error);
      errorRef.current?.focus();
      return;
    }
    setError(null);
    setGate(null);
    setSubmitting(true);
    try {
      onSubmitted(await api.applications.create(result.input));
    } catch (err) {
      const refusal = verificationRequired(err);
      if (refusal) setGate(refusal);
      else setError(err instanceof ApiError ? err.message : 'Your application was not sent. Please try again.');
      errorRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  const fromProfile = (field: keyof PrefilledFields) => (loaded.prefilled[field] ? <FromProfile /> : null);

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-5">
      <p className="text-sm text-text-body">
        The landlord sees your name, your verification badge and rating, and what you send here. Change anything
        before you send it.
      </p>
      {loaded.profileFailed ? (
        <p className="rounded-lg border border-warning p-3 text-sm text-warning">
          Your saved profile couldn&apos;t be loaded, so nothing is filled in for you.
        </p>
      ) : null}

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field hint={fromProfile('moveInDate')}>
          <Input
            label="Move-in date"
            type="date"
            min={today}
            value={draft.moveInDate}
            onChange={(event) => set('moveInDate', event.target.value)}
          />
        </Field>
        <Field hint={fromProfile('occupants')}>
          <Input
            label="People living there"
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            step={1}
            value={draft.occupants}
            onChange={(event) => set('occupants', event.target.value)}
          />
        </Field>
        <Field hint={fromProfile('offer')}>
          <Input
            label="Weekly rent you offer ($)"
            type="number"
            inputMode="decimal"
            min={1}
            step="any"
            value={draft.offer}
            aria-describedby={`${id}-asking`}
            onChange={(event) => set('offer', event.target.value)}
          />
          <p id={`${id}-asking`} className="text-xs text-text-body">Asking rent: {formatMoney(listing.price)} a week</p>
        </Field>
        <Field>
          <Input
            label="Yearly income ($, optional)"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={draft.income}
            onChange={(event) => set('income', event.target.value)}
          />
        </Field>
      </div>

      <fieldset className="min-w-0">
        <legend className={label}>Pets</legend>
        <div className="mt-2 flex flex-wrap items-center gap-x-3">
          <label className="flex min-h-11 items-center gap-3 text-sm text-text-dark">
            <input
              type="checkbox"
              checked={draft.hasPets}
              onChange={(event) => set('hasPets', event.target.checked)}
              className="size-5 accent-primary-strong"
            />
            I have pets
          </label>
          {fromProfile('hasPets')}
        </div>
        {draft.hasPets ? (
          <Field hint={fromProfile('pets')}>
            <Input
              label="About your pets"
              placeholder="One indoor cat"
              maxLength={200}
              value={draft.pets}
              onChange={(event) => set('pets', event.target.value)}
            />
          </Field>
        ) : null}
      </fieldset>

      <Field hint={fromProfile('about')}>
        <label htmlFor={`${id}-about`} className={label}>About you</label>
        <textarea
          id={`${id}-about`}
          rows={3}
          maxLength={2000}
          value={draft.about}
          onChange={(event) => set('about', event.target.value)}
          className={textArea}
        />
      </Field>
      <Field>
        <label htmlFor={`${id}-message`} className={label}>Message to the landlord (optional)</label>
        <textarea
          id={`${id}-message`}
          rows={3}
          maxLength={2000}
          value={draft.message}
          onChange={(event) => set('message', event.target.value)}
          className={textArea}
        />
      </Field>

      <fieldset className="min-w-0">
        <legend className={label}>Documents to share</legend>
        {documentsFailed ? (
          <p className="mt-2 text-sm text-text-body">
            Your documents couldn&apos;t be loaded. You can still apply without them.
          </p>
        ) : shareable === null ? (
          <p className="mt-2 text-sm text-text-body">Loading your documents…</p>
        ) : shareable.length === 0 ? (
          <p className="mt-2 text-sm text-text-body">
            You haven&apos;t chosen any documents to share with landlords.{' '}
            <Link href="/tenant/id-verification" className="font-semibold text-primary-strong underline">
              Choose documents to share
            </Link>
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-text-body">
              Only documents you marked as shareable are listed. The landlord opens them through a link that works for
              a few minutes.
            </p>
            <ul className="mt-2 space-y-1">
              {shareable.map((doc) => (
                <li key={doc.id}>
                  <label className="flex min-h-11 items-center gap-3 text-sm text-text-dark">
                    <input
                      type="checkbox"
                      checked={draft.documentIds.includes(doc.id)}
                      onChange={(event) => toggleDocument(doc.id, event.target.checked)}
                      className="size-5 shrink-0 accent-primary-strong"
                    />
                    <span className="min-w-0 break-words">
                      {doc.label} <span className="text-text-body">· {DOCUMENT_STATUS[doc.status]}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </fieldset>

      <div ref={errorRef} tabIndex={-1}>
        {gate ? <VerificationRequired detail={gate} /> : null}
        <FormMessage error={error} />
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={submitting} aria-busy={submitting}>
          {submitting ? 'Sending application…' : 'Send application'}
        </Button>
      </div>
    </form>
  );
}

function Field({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {children}
      {hint}
    </div>
  );
}

function FromProfile() {
  return <span className="text-xs font-medium text-success">Filled in from your profile</span>;
}
