'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import WizardSteps from '@/app/components/owner/WizardSteps';
import VerificationRequired from '@/app/components/trust/VerificationRequired';
import { api, ApiError, type PropertyInput } from '@/app/lib/api';
import {
  clearDraft,
  draftToPropertyInput,
  getDraft,
  saveDraft,
  type ListingDraft,
} from '@/app/lib/owner-listing-draft';
import { verificationRequired, type VerificationRequiredDetail } from '@/app/lib/verification-gate';

/**
 * The wizard's last step, which publishes the listing. Publishing needs a
 * verified account (R18): when the server refuses it, VerificationRequired
 * says why, and the listing can be saved off the market instead, to publish
 * from its page once the account is verified.
 */
export default function CreateListingRentalTermsPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<ListingDraft>({});
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<VerificationRequiredDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const gateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Hydrate the client-only localStorage draft after mount. This cannot be
    // lazy initial state: the server renders an empty draft, so reading
    // localStorage during the first render would mismatch the SSR markup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(getDraft());
  }, []);

  function set<K extends keyof ListingDraft>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function create(input: PropertyInput) {
    setSubmitting(true);
    try {
      const created = await api.properties.create(input);
      clearDraft();
      router.push(`/owner/properties/${created.id}`);
      router.refresh();
    } catch (err) {
      const refusal = verificationRequired(err);
      if (refusal) {
        setGate(refusal);
        requestAnimationFrame(() => gateRef.current?.focus());
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not publish the listing. Please try again.',
        );
      }
      setSubmitting(false);
    }
  }

  function input(): PropertyInput | null {
    const merged = { ...getDraft(), ...draft };
    saveDraft(draft);

    const result = draftToPropertyInput(merged);
    if ('error' in result) {
      setError(result.error);
      return null;
    }
    return result.input;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setGate(null);
    const listing = input();
    if (listing) await create(listing);
  }

  async function saveUnpublished() {
    if (submitting) return;
    setError(null);
    const listing = input();
    // Off the market, the listing needs no verification; publishing it later does.
    if (listing) await create({ ...listing, status: 'off_market' });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-dark">Create New Listing</h1>
        <div className="mt-4">
          <WizardSteps current={2} />
        </div>
      </div>

      <Card className="p-6">
        <h2 className="font-heading text-lg font-semibold text-text-dark">Rental Terms</h2>
        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Rent (per week)"
              type="number"
              min={0}
              step={1}
              placeholder="720"
              value={draft.price ?? ''}
              onChange={(e) => set('price', e.target.value)}
              required
            />
            <Input
              label="Bond / Deposit"
              type="number"
              min={0}
              step={1}
              placeholder="2880"
              value={draft.bond ?? ''}
              onChange={(e) => set('bond', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Lease Term"
              placeholder="12 months"
              value={draft.lease_term ?? ''}
              onChange={(e) => set('lease_term', e.target.value)}
            />
            <Input
              label="Available From"
              type="date"
              value={draft.available_from ?? ''}
              onChange={(e) => set('available_from', e.target.value)}
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
              {error}
            </p>
          ) : null}
          {gate ? (
            <div ref={gateRef} tabIndex={-1} className="flex flex-col gap-3">
              <VerificationRequired detail={gate} />
              <div>
                <Button type="button" variant="secondary" disabled={submitting} onClick={saveUnpublished}>
                  {submitting ? 'Saving…' : 'Save it unpublished'}
                </Button>
                <p className="mt-1 text-xs text-text-body">
                  It stays off the market; publish it from its page once your account is verified.
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <Link href="/owner/properties/create/photos" onClick={() => saveDraft(draft)}>
              <Button type="button" variant="secondary">
                Back
              </Button>
            </Link>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Publishing…' : 'Publish Listing'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
