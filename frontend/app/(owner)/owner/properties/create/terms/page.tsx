'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import WizardSteps from '@/app/components/owner/WizardSteps';
import { api, ApiError } from '@/app/lib/api';
import {
  clearDraft,
  draftToPropertyInput,
  getDraft,
  saveDraft,
  type ListingDraft,
} from '@/app/lib/owner-listing-draft';

export default function CreateListingRentalTermsPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<ListingDraft>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDraft(getDraft());
  }, []);

  function set<K extends keyof ListingDraft>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const merged = { ...getDraft(), ...draft };
    saveDraft(draft);

    const result = draftToPropertyInput(merged);
    if ('error' in result) {
      setError(result.error);
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.properties.create(result.input);
      clearDraft();
      router.push(`/owner/properties/${created.id}`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not publish the listing. Please try again.',
      );
      setSubmitting(false);
    }
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
              placeholder="720"
              value={draft.price ?? ''}
              onChange={(e) => set('price', e.target.value)}
              required
            />
            <Input
              label="Bond / Deposit"
              type="number"
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
