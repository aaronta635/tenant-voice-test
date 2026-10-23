'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import { api, ApiError, safe, type Property, type PropertyUpdate } from '@/app/lib/api';
import {
  MAX_FEATURES,
  MAX_PHOTOS,
  PHOTO_TYPES,
  PROPERTY_TYPE_LABELS,
  featureOptions,
  photoRefusal,
  photosWithinLimit,
} from '@/app/lib/listings';
import { changedFields, numberOrNull, numberText, textOrNull } from '@/app/lib/my-profile';
import { isRemoteImage } from '@/app/lib/remote-image';

type Props = {
  property: Property;
  onSaved: (updated: Property) => void;
  /** Leave the editor; photos uploaded and not saved are deleted first. */
  onCancel: () => void;
};

type ListingForm = {
  title: string;
  description: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  property_type: string;
  bedrooms: string;
  bathrooms: string;
  parking: string;
  price: string;
  bond: string;
  lease_term: string;
  available_from: string;
  amenities: string[];
  photo_urls: string[];
};

const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
const REQUIRED: [keyof ListingForm, string][] = [
  ['title', 'Add a title.'], ['address', 'Add the street address.'], ['suburb', 'Add the suburb.'],
  ['state', 'Choose the state.'], ['postcode', 'Add the postcode.'],
];
const COUNTS: [keyof ListingForm, string][] = [['bedrooms', 'Bedrooms'], ['bathrooms', 'Bathrooms'], ['parking', 'Parking spaces']];

const label = 'text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body';
const select = 'min-h-11 w-full rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong';

function formOf(property: Property): ListingForm {
  return {
    title: property.title,
    description: property.description ?? '',
    address: property.street_address ?? '',
    suburb: property.suburb ?? '',
    state: property.state ?? '',
    postcode: property.postcode ?? '',
    property_type: property.property_type && PROPERTY_TYPE_LABELS[property.property_type] ? property.property_type : 'other',
    bedrooms: numberText(property.bedrooms),
    bathrooms: numberText(property.bathrooms),
    parking: numberText(property.parking),
    price: numberText(property.price),
    bond: numberText(property.bond),
    lease_term: property.lease_term ?? '',
    available_from: property.available_from ?? '',
    amenities: property.amenities ?? [],
    photo_urls: property.photo_urls ?? [],
  };
}

/** The patch for what changed, or the first thing to fix. A field emptied is sent as null, which clears it. */
function changesOf(saved: ListingForm, form: ListingForm): { changes: PropertyUpdate } | { error: string } {
  const changed = changedFields(saved, form);
  for (const [field, message] of REQUIRED) {
    if (field in changed && !String(form[field]).trim()) return { error: message };
  }
  const changes: PropertyUpdate = {};
  for (const field of ['title', 'address', 'suburb', 'state', 'postcode'] as const) {
    if (field in changed) changes[field] = form[field].trim();
  }
  if ('price' in changed) {
    const price = numberOrNull(form.price);
    if (price === null || !Number.isFinite(price) || price <= 0) return { error: 'Enter the weekly rent.' };
    changes.price = price;
  }
  if ('bond' in changed) {
    const bond = numberOrNull(form.bond);
    if (bond !== null && (!Number.isFinite(bond) || bond < 0)) return { error: 'Enter the bond as an amount, or leave it empty.' };
    changes.bond = bond;
  }
  for (const [field, name] of COUNTS) {
    if (!(field in changed)) continue;
    const count = numberOrNull(String(form[field]));
    if (count !== null && (!Number.isInteger(count) || count < 0 || count > 50)) return { error: `${name} must be a whole number from 0 to 50.` };
    changes[field as 'bedrooms' | 'bathrooms' | 'parking'] = count;
  }
  if ('description' in changed) changes.description = textOrNull(form.description);
  if ('lease_term' in changed) changes.lease_term = textOrNull(form.lease_term);
  if ('available_from' in changed) changes.available_from = form.available_from || null;
  if ('property_type' in changed) changes.property_type = form.property_type;
  if ('amenities' in changed) changes.amenities = form.amenities;
  if ('photo_urls' in changed) changes.photo_urls = form.photo_urls;
  return { changes };
}

/**
 * Every field of a listing (R25): its text, address, rooms, rent and terms,
 * features and photos. Photos upload as they are added (POST
 * /uploads/property-image); one removed before saving is deleted, and one
 * the listing showed goes when the edit is saved. Only what changed is sent.
 */
export default function ListingEditor({ property, onSaved, onCancel }: Props) {
  const [saved, setSaved] = useState(() => formOf(property));
  const [form, setForm] = useState(() => formOf(property));
  const [options, setOptions] = useState<string[]>([]);
  const [newFeature, setNewFeature] = useState('');
  const [uploading, setUploading] = useState(0);
  const [photoProblems, setPhotoProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  // Photos uploaded in this edit and not saved on the listing yet.
  const uploaded = useRef(new Set<string>());
  // Uploads finish after later renders, so each adds to the newest list.
  const photos = useRef(form.photo_urls);
  const id = useId();

  useEffect(() => {
    let active = true;
    safe(api.properties.amenities(), []).then((list) => {
      if (active) setOptions(featureOptions(list));
    });
    return () => {
      active = false;
    };
  }, []);

  function set<K extends keyof ListingForm>(key: K, value: ListingForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSuccess(null);
  }

  function setPhotos(next: string[]) {
    photos.current = next;
    set('photo_urls', next);
  }

  function discard(url: string) {
    // An upload is public at once, so one taken out before saving is deleted. The API keeps a photo a listing shows.
    if (!uploaded.current.delete(url)) return;
    void safe(api.uploads.discardPropertyImage(url), undefined);
  }

  async function addPhotos(files: FileList | null) {
    const chosen = Array.from(files ?? []);
    if (fileInput.current) fileInput.current.value = '';
    if (chosen.length === 0) return;
    const wrong = chosen.map(photoRefusal).filter((problem): problem is string => problem !== null);
    const room = photosWithinLimit(photos.current.length + uploading, chosen.filter((file) => photoRefusal(file) === null));
    const refused = [...wrong, ...room.refused];
    const accepted = room.accepted;
    setPhotoProblems(refused);
    if (accepted.length === 0) return;
    setUploading((count) => count + accepted.length);
    // The listing exists, so its photos go to its property's folder, as the mobile app keeps them.
    const results = await Promise.allSettled(accepted.map((file) => api.properties.uploadPhoto(property.id, file)));
    setUploading((count) => count - accepted.length);
    const links: string[] = [];
    const failed: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') links.push(result.value.url);
      else failed.push(`${accepted[index].name}: ${result.reason instanceof ApiError ? result.reason.message : 'it could not be uploaded.'}`);
    });
    for (const link of links) uploaded.current.add(link);
    if (links.length) setPhotos([...photos.current, ...links]);
    setPhotoProblems([...refused, ...failed]);
  }

  function removePhoto(index: number) {
    const removed = photos.current[index];
    setPhotos(photos.current.filter((_, position) => position !== index));
    if (removed) discard(removed);
  }

  function makeCover(index: number) {
    const chosen = photos.current[index];
    setPhotos([chosen, ...photos.current.filter((_, position) => position !== index)]);
  }

  const featuresFull = form.amenities.length >= MAX_FEATURES;

  function toggleFeature(feature: string) {
    if (form.amenities.includes(feature)) set('amenities', form.amenities.filter((item) => item !== feature));
    else if (!featuresFull) set('amenities', [...form.amenities, feature]);
  }

  function addFeature() {
    const feature = newFeature.trim();
    if (!feature || featuresFull) return;
    if (!form.amenities.some((item) => item.toLowerCase() === feature.toLowerCase())) set('amenities', [...form.amenities, feature]);
    setNewFeature('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || uploading > 0) return;
    const result = changesOf(saved, form);
    setSuccess(null);
    if ('error' in result) {
      setError(result.error);
      feedback.current?.focus();
      return;
    }
    if (Object.keys(result.changes).length === 0) {
      setError(null);
      setSuccess('Nothing has changed since the last save.');
      feedback.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.properties.update(property.id, result.changes);
      const next = formOf(updated);
      for (const url of next.photo_urls) uploaded.current.delete(url);
      photos.current = next.photo_urls;
      setSaved(next);
      setForm(next);
      setSuccess('Changes saved.');
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Your changes were not saved. Please try again.');
    } finally {
      setSaving(false);
      feedback.current?.focus();
    }
  }

  function cancel() {
    for (const url of [...uploaded.current]) discard(url);
    onCancel();
  }

  const states = STATES.includes(form.state) || !form.state ? STATES : [form.state, ...STATES];
  const features = Array.from(new Set([...options, ...form.amenities]));

  return (
    <form onSubmit={save} noValidate className="flex min-w-0 flex-col gap-6">
      <Section title="The listing">
        <Input label="Title" required maxLength={120} value={form.title} onChange={(e) => set('title', e.target.value)} />
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-description`} className={label}>Description</label>
          <textarea
            id={`${id}-description`}
            rows={6}
            maxLength={5000}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className="w-full rounded-lg border border-control-border bg-white p-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
          />
        </div>
      </Section>

      <Section
        title="Address"
        note="Signed-out visitors see only the suburb, state and postcode, and a title that names the street is replaced for them. The description is shown to everyone as you write it, so leave the street out of it."
      >
        <Input label="Street address" required maxLength={200} value={form.address} onChange={(e) => set('address', e.target.value)} />
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <Input label="Suburb" required maxLength={100} value={form.suburb} onChange={(e) => set('suburb', e.target.value)} />
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-state`} className={label}>State</label>
            <select id={`${id}-state`} value={form.state} onChange={(e) => set('state', e.target.value)} className={select}>
              <option value="">Choose…</option>
              {states.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
          </div>
          <Input label="Postcode" required inputMode="numeric" maxLength={10} value={form.postcode} onChange={(e) => set('postcode', e.target.value)} />
        </div>
      </Section>

      <Section title="Rooms">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-type`} className={label}>Property type</label>
            <select id={`${id}-type`} value={form.property_type} onChange={(e) => set('property_type', e.target.value)} className={select}>
              {Object.entries(PROPERTY_TYPE_LABELS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </div>
          <Input label="Bedrooms" type="number" min={0} max={50} step={1} value={form.bedrooms} onChange={(e) => set('bedrooms', e.target.value)} />
          <Input label="Bathrooms" type="number" min={0} max={50} step={1} value={form.bathrooms} onChange={(e) => set('bathrooms', e.target.value)} />
          <Input label="Parking spaces" type="number" min={0} max={50} step={1} value={form.parking} onChange={(e) => set('parking', e.target.value)} />
        </div>
      </Section>

      <Section title="Rent and terms">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Input label="Weekly rent ($)" required type="number" min={1} step="any" value={form.price} onChange={(e) => set('price', e.target.value)} />
          <Input label="Bond ($)" type="number" min={0} step="any" value={form.bond} onChange={(e) => set('bond', e.target.value)} />
          <Input label="Lease term" placeholder="12 months" maxLength={40} value={form.lease_term} onChange={(e) => set('lease_term', e.target.value)} />
          <Input label="Available from" type="date" value={form.available_from} onChange={(e) => set('available_from', e.target.value)} />
        </div>
      </Section>

      <Section title="Features">
        {features.length ? (
          <div role="group" aria-label="Features" className="flex flex-wrap gap-2">
            {features.map((feature) => {
              const on = form.amenities.includes(feature);
              return (
                <button
                  key={feature}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && featuresFull}
                  onClick={() => toggleFeature(feature)}
                  className={`min-h-11 rounded-full border px-4 text-sm ${on ? 'border-primary-strong bg-primary-strong font-semibold text-white' : 'border-control-border bg-white text-text-dark hover:bg-surface'}`}
                >
                  {feature}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-48">
            <Input label="Add a feature" maxLength={60} value={newFeature} onChange={(e) => setNewFeature(e.target.value)} />
          </div>
          <Button type="button" variant="secondary" onClick={addFeature} disabled={featuresFull}>Add feature</Button>
        </div>
        {featuresFull ? <p className="text-sm text-text-body">A listing keeps up to {MAX_FEATURES} features. Remove one to add another.</p> : null}
      </Section>

      <Section
        title={`Photos (${form.photo_urls.length})`}
        note={`The first photo is the cover. Up to ${MAX_PHOTOS} photos: JPEG, PNG, WebP or GIF, up to 3 MB each; each uploads as you add it.`}
      >
        <input
          ref={fileInput}
          type="file"
          accept={PHOTO_TYPES.join(',')}
          multiple
          className="sr-only"
          aria-label="Add listing photos"
          onChange={(event) => void addPhotos(event.target.files)}
        />
        {form.photo_urls.length === 0 ? <p className="text-sm text-text-body">No photos yet.</p> : (
          <ul className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-4">
            {form.photo_urls.map((src, index) => (
              <li key={`${src}-${index}`} className="min-w-0 overflow-hidden rounded-xl border border-border">
                <div className="relative h-32 w-full">
                  <Image src={src} alt={`Listing photo ${index + 1}`} fill sizes="(min-width: 1024px) 220px, 50vw" className="object-cover" unoptimized={isRemoteImage(src)} />
                </div>
                <div className="flex flex-wrap gap-1 p-2">
                  {index === 0 ? (
                    <span className="inline-flex min-h-10 items-center px-2 text-xs font-semibold text-success">Cover photo</span>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" onClick={() => makeCover(index)} aria-label={`Make photo ${index + 1} the cover`}>
                      Make cover
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="text-danger" onClick={() => removePhoto(index)} aria-label={`Remove photo ${index + 1}`}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={form.photo_urls.length + uploading >= MAX_PHOTOS}
          onClick={() => fileInput.current?.click()}
        >
          Add photos
        </Button>
        <p role="status" aria-live="polite" className="text-sm text-text-body">
          {uploading > 0 ? `Uploading ${uploading} photo${uploading === 1 ? '' : 's'}…` : ''}
        </p>
        <div role="alert" aria-atomic="true" className={photoProblems.length ? 'rounded-lg border border-danger p-3 text-sm text-danger' : ''}>
          {photoProblems.map((problem, index) => <p key={index}>{problem}</p>)}
        </div>
      </Section>

      <div ref={feedback} tabIndex={-1}>
        <FormMessage error={error} success={success} />
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={saving} onClick={cancel}>Back to the listing</Button>
        <Button type="submit" disabled={saving || uploading > 0} aria-busy={saving}>
          {saving ? 'Saving…' : uploading > 0 ? 'Uploading…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-white p-5">
      <h2 id={id} className="font-heading text-h4 font-semibold text-text-dark">{title}</h2>
      {note ? <p className="-mt-2 text-sm text-text-body">{note}</p> : null}
      {children}
    </section>
  );
}
