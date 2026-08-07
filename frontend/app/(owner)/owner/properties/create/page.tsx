'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import WizardSteps from '@/app/components/owner/WizardSteps';
import { getDraft, saveDraft, type ListingDraft } from '@/app/lib/owner-listing-draft';

export default function CreateListingPropertyDetailsPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<ListingDraft>({});

  useEffect(() => {
    setDraft(getDraft());
  }, []);

  function set<K extends keyof ListingDraft>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    saveDraft(draft);
    router.push('/owner/properties/create/photos');
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-dark">Create New Listing</h1>
        <div className="mt-4">
          <WizardSteps current={0} />
        </div>
      </div>

      <Card className="p-6">
        <h2 className="font-heading text-lg font-semibold text-text-dark">Property Details</h2>
        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
          <Input
            label="Listing Title"
            placeholder="Modern City Apartment"
            value={draft.title ?? ''}
            onChange={(e) => set('title', e.target.value)}
            required
          />
          <Input
            label="Property Address"
            placeholder="123 Main St"
            value={draft.address ?? ''}
            onChange={(e) => set('address', e.target.value)}
            required
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="City"
              placeholder="Cityville"
              value={draft.suburb ?? ''}
              onChange={(e) => set('suburb', e.target.value)}
            />
            <Input
              label="State"
              placeholder="NSW"
              value={draft.state ?? ''}
              onChange={(e) => set('state', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Property Type"
              placeholder="Apartment"
              value={draft.property_type ?? ''}
              onChange={(e) => set('property_type', e.target.value)}
            />
            <Input
              label="Postcode"
              placeholder="2000"
              value={draft.postcode ?? ''}
              onChange={(e) => set('postcode', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Bedrooms"
              type="number"
              placeholder="2"
              value={draft.bedrooms ?? ''}
              onChange={(e) => set('bedrooms', e.target.value)}
            />
            <Input
              label="Bathrooms"
              type="number"
              placeholder="2"
              value={draft.bathrooms ?? ''}
              onChange={(e) => set('bathrooms', e.target.value)}
            />
          </div>

          <div className="mt-2 flex justify-end">
            <Button type="submit" variant="primary">
              Continue
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
