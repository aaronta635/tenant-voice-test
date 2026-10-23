'use client';

import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import WizardSteps from '@/app/components/owner/WizardSteps';
import { PlusIcon } from '@/app/components/owner/icons';
import { getDraft, saveDraft, uploadedPhotos } from '@/app/lib/owner-listing-draft';
import { api, ApiError, safe } from '@/app/lib/api';
import {
  MAX_FEATURES,
  MAX_PHOTOS,
  PHOTO_TYPES,
  featureOptions,
  photoRefusal as refusal,
  photosWithinLimit,
} from '@/app/lib/listings';

export default function CreateListingPhotosDescriptionPage() {
  const descriptionId = useId();
  const [description, setDescription] = useState('');
  const [amenities, setAmenities] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  // The picker vocabulary is every amenity already used across listings.
  const [options, setOptions] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Uploads finish after later renders, so each adds to the newest list.
  const photosRef = useRef<string[]>([]);

  useEffect(() => {
    // Hydrate the client-only localStorage draft after mount. This cannot be
    // lazy initial state: the server renders an empty draft, so reading
    // localStorage during the first render would mismatch the SSR markup.
    const draft = getDraft();
    photosRef.current = uploadedPhotos(draft.photo_urls);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDescription(draft.description ?? '');
    // An older draft may hold more, or longer, features than the API keeps.
    setAmenities(featureOptions(draft.amenities ?? []).slice(0, MAX_FEATURES));
    setPhotos(photosRef.current);

    let active = true;
    safe(api.properties.amenities(), []).then((list) => {
      if (active) setOptions(featureOptions(list));
    });
    return () => {
      active = false;
    };
  }, []);

  const featuresFull = amenities.length >= MAX_FEATURES;

  function toggleAmenity(amenity: string) {
    setAmenities((prev) => {
      if (prev.includes(amenity)) return prev.filter((a) => a !== amenity);
      return prev.length >= MAX_FEATURES ? prev : [...prev, amenity];
    });
  }

  function showPhotos(next: string[]) {
    photosRef.current = next;
    setPhotos(next);
    saveDraft({ photo_urls: next });
  }

  function persist() {
    saveDraft({ description, amenities, photo_urls: photosRef.current });
  }

  function leave(event: MouseEvent<HTMLAnchorElement>) {
    // Leaving now would drop the photos still on their way up.
    if (uploading > 0) {
      event.preventDefault();
      return;
    }
    persist();
  }

  async function onFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const chosen = Array.from(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
    const wrong = chosen.map(refusal).filter((problem): problem is string => problem !== null);
    const room = photosWithinLimit(photosRef.current.length + uploading, chosen.filter((file) => refusal(file) === null));
    const refused = [...wrong, ...room.refused];
    const accepted = room.accepted;
    setProblems(refused);
    if (accepted.length === 0) return;

    // Each photo is stored as it is added; the draft keeps only its link.
    setUploading((count) => count + accepted.length);
    const results = await Promise.allSettled(accepted.map((file) => api.uploads.propertyImage(file)));
    setUploading((count) => count - accepted.length);
    const links: string[] = [];
    const failed: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        links.push(result.value.url);
      } else {
        const reason = result.reason instanceof ApiError ? result.reason.message : 'it could not be uploaded.';
        failed.push(`${accepted[index].name}: ${reason}`);
      }
    });
    if (links.length > 0) showPhotos([...photosRef.current, ...links]);
    setProblems([...refused, ...failed]);
  }

  function removePhoto(index: number) {
    const removed = photosRef.current[index];
    showPhotos(photosRef.current.filter((_, i) => i !== index));
    // An uploaded photo is public at once: delete its file too. The API keeps
    // one a listing shows, and a failure only leaves the file behind.
    if (removed) void safe(api.uploads.discardPropertyImage(removed), undefined);
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

        <input
          ref={fileInputRef}
          type="file"
          accept={PHOTO_TYPES.join(',')}
          multiple
          className="sr-only"
          aria-label="Add listing photos"
          onChange={(event) => void onFilesSelected(event.target.files)}
        />
        <div className="mt-4 flex flex-wrap gap-3">
          {photos.map((src, index) => (
            <div key={`${src}-${index}`} className="relative size-24 overflow-hidden rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Listing photo ${index + 1}`} className="size-full object-cover" />
              <button
                type="button"
                aria-label={`Remove photo ${index + 1}`}
                onClick={() => removePhoto(index)}
                className="absolute right-1 top-1 rounded-full bg-[#171a1f]/70 px-1.5 text-xs text-white"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            aria-label="Add photos"
            disabled={photos.length + uploading >= MAX_PHOTOS}
            onClick={() => fileInputRef.current?.click()}
            className="flex size-24 items-center justify-center rounded-xl border-2 border-dashed border-border text-text-body hover:border-primary hover:text-primary"
          >
            <PlusIcon size={24} />
          </button>
        </div>
        <p className="mt-2 text-xs text-text-subtle">
          Add at least one photo, up to {MAX_PHOTOS}: JPEG, PNG, WebP or GIF, up to 3 MB each. Each photo
          uploads as you add it.
        </p>
        <p role="status" aria-live="polite" className="mt-2 text-sm text-text-body">
          {uploading > 0 ? `Uploading ${uploading} photo${uploading === 1 ? '' : 's'}…` : ''}
        </p>
        <div
          role="alert"
          aria-atomic="true"
          className={
            problems.length > 0
              ? 'mt-2 rounded-xl border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]'
              : ''
          }
        >
          {problems.map((problem, index) => (
            <p key={index}>{problem}</p>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-[6px]">
          <label htmlFor={descriptionId} className="text-[11px] font-semibold tracking-[0.8px] text-text-body uppercase">
            Description
          </label>
          <textarea
            id={descriptionId}
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
                  aria-pressed={active}
                  disabled={!active && featuresFull}
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
          {featuresFull ? (
            <p className="mt-2 text-sm text-text-body">
              A listing keeps up to {MAX_FEATURES} features. Remove one to add another.
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Link href="/owner/properties" onClick={leave} aria-disabled={uploading > 0}>
            <Button type="button" variant="ghost">
              Save & exit
            </Button>
          </Link>
          <Link href="/owner/properties/create/terms" onClick={leave} aria-disabled={uploading > 0}>
            <Button type="button" variant="primary">
              {uploading > 0 ? 'Uploading…' : 'Continue'}
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
