'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import WizardSteps from '@/app/components/owner/WizardSteps';
import { PlusIcon } from '@/app/components/owner/icons';
import { getDraft, saveDraft } from '@/app/lib/owner-listing-draft';
import { api, safe } from '@/app/lib/api';

export default function CreateListingPhotosDescriptionPage() {
  const [description, setDescription] = useState('');
  const [amenities, setAmenities] = useState<string[]>([]);
  // The picker vocabulary is every amenity already used across listings.
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    const draft = getDraft();
    setDescription(draft.description ?? '');
    setAmenities(draft.amenities ?? []);

    let active = true;
    safe(api.properties.amenities(), []).then((list) => {
      if (active) setOptions(list);
    });
    return () => {
      active = false;
    };
  }, []);

  function toggleAmenity(amenity: string) {
    setAmenities((prev) =>
      prev.includes(amenity) ? prev.filter((a) => a !== amenity) : [...prev, amenity],
    );
  }

  function persist() {
    saveDraft({ description, amenities });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-dark">Create New Listing</h1>
        <div className="mt-4">
          <WizardSteps current={1} />
        </div>
      </div>

      <Card className="p-6">
        <h2 className="font-heading text-lg font-semibold text-text-dark">
          Photos & Description
        </h2>

        {/* TODO: real photo upload pending storage/backend integration — placeholder only.
            Photos are not persisted with the listing yet (photo_urls left empty). */}
        <div className="mt-4 flex flex-wrap gap-3">
          <div className="flex size-24 items-center justify-center rounded-xl bg-[#f3f4f6] text-text-subtle">
            <span className="text-xs">Photo 1</span>
          </div>
          <div className="flex size-24 items-center justify-center rounded-xl bg-[#f3f4f6] text-text-subtle">
            <span className="text-xs">Photo 2</span>
          </div>
          <button
            type="button"
            className="flex size-24 items-center justify-center rounded-xl border-2 border-dashed border-border text-text-body hover:border-primary hover:text-primary"
          >
            <PlusIcon size={24} />
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-[6px]">
          <label className="text-[11px] font-semibold tracking-[0.8px] text-text-body uppercase">
            Description
          </label>
          <textarea
            rows={5}
            placeholder="Describe the property..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-[#dee1e6] bg-[rgba(243,244,246,0.4)] p-3 text-sm text-text-dark placeholder:text-text-subtle focus:border-transparent focus:ring-2 focus:ring-primary focus:outline-none"
          />
        </div>

        <div className="mt-6">
          <p className="text-[11px] font-semibold tracking-[0.8px] text-text-body uppercase">
            Amenities
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Array.from(new Set([...options, ...amenities])).map((amenity) => {
              const active = amenities.includes(amenity);
              return (
                <button
                  key={amenity}
                  type="button"
                  onClick={() => toggleAmenity(amenity)}
                  className={`rounded-full border px-4 py-2 text-sm ${
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-text-dark hover:border-primary hover:text-primary'
                  }`}
                >
                  {amenity}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Link href="/owner/properties" onClick={persist}>
            <Button type="button" variant="ghost">
              Save & exit
            </Button>
          </Link>
          <Link href="/owner/properties/create/terms" onClick={persist}>
            <Button type="button" variant="primary">
              Continue
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
