'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import { REPAIR_CATEGORIES, type RepairCategory } from '@/app/lib/repair-categories';
import {
  MAX_REPAIR_PHOTOS,
  PHOTO_TYPES,
  photoProblem,
  PRIORITY_OPTIONS,
  repairs,
  reportProblem,
  type Repair,
  type RepairHome,
  type RepairPriority,
} from '@/app/lib/repairs';

type Props = {
  homes: RepairHome[];
  viewer: 'tenant' | 'owner';
  onCreated: (repair: Repair) => void;
};

type Photo = { file: File; path: string | null };

const fieldClass = 'mt-1.5 w-full min-w-0 rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
const labelClass = 'block text-sm font-semibold text-text-dark';

/**
 * Report a repair (a tenant) or log one (an owner) for one of the caller's
 * homes. Photos upload when the report is sent; one already uploaded is not
 * sent again when the report is retried.
 */
export default function RepairReportForm({ homes, viewer, onCreated }: Props) {
  const id = useId();
  const [home, setHome] = useState(homes[0]?.listing_id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<RepairCategory>('GENERAL');
  const [priority, setPriority] = useState<RepairPriority>('medium');
  const [accessNotes, setAccessNotes] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function addPhotos(files: FileList | null) {
    setError(null);
    const added: Photo[] = [];
    for (const file of Array.from(files ?? [])) {
      const problem = photoProblem(file, photos.length + added.length);
      if (problem) {
        setError(problem);
        break;
      }
      added.push({ file, path: null });
    }
    setPhotos((list) => [...list, ...added]);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const problem = reportProblem({ property_id: home, title, description });
    if (problem) {
      setError(problem);
      setNotice(null);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const uploaded: Photo[] = [];
      for (const photo of photos) {
        const stored = photo.path ? photo : { ...photo, path: (await repairs.uploadPhoto(photo.file)).path };
        uploaded.push(stored);
        // Kept at once: when a later photo fails, a retry does not store this one again.
        if (stored !== photo) setPhotos((current) => current.map((item) => (item === photo ? stored : item)));
      }
      const created = await repairs.create({
        property_id: home,
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
        photos: uploaded.map((photo) => photo.path as string),
        access_notes: accessNotes.trim() || null,
      });
      onCreated(created);
      setTitle('');
      setDescription('');
      setCategory('GENERAL');
      setPriority('medium');
      setAccessNotes('');
      setPhotos([]);
      setNotice(viewer === 'tenant' ? 'Repair reported. Your landlord has been told.' : 'Repair logged. Your tenant has been told.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send this repair. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={viewer === 'tenant' ? 'Report a repair' : 'Log a repair'} className="mt-4 space-y-4">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>
          Home
          <select value={home} onChange={(event) => setHome(event.target.value)} className={fieldClass}>
            {homes.map((option) => (
              <option key={option.listing_id} value={option.listing_id}>
                {option.address ? `${option.title}, ${option.address}` : option.title}
              </option>
            ))}
          </select>
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Title
          <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Burst pipe under the kitchen sink" className={fieldClass} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          What is wrong?
          <textarea rows={4} value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value as RepairCategory)} className={fieldClass}>
            {REPAIR_CATEGORIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Priority
          <select value={priority} onChange={(event) => setPriority(event.target.value as RepairPriority)} className={fieldClass}>
            {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Access notes (optional)
          <input value={accessNotes} maxLength={500} onChange={(event) => setAccessNotes(event.target.value)} placeholder="e.g. Key in the lockbox, call before you come" className={fieldClass} />
          <span className="mt-1 block text-xs font-normal text-text-body">The provider sees these once they book the visit.</span>
        </label>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`${id}-photos`}>Photos (optional, up to {MAX_REPAIR_PHOTOS})</label>
          <input id={`${id}-photos`} ref={fileInput} type="file" multiple accept={PHOTO_TYPES.join(',')}
            disabled={busy || photos.length >= MAX_REPAIR_PHOTOS} onChange={(event) => addPhotos(event.target.files)}
            className="mt-1.5 block w-full min-w-0 text-sm text-text-body" />
          {photos.length ? (
            <ul className="mt-2 space-y-1 text-sm text-text-body" aria-label="Photos to send">
              {photos.map((photo, index) => (
                <li key={`${photo.file.name}-${index}`} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-all">{photo.file.name}</span>
                  <button type="button" onClick={() => setPhotos((list) => list.filter((_, i) => i !== index))}
                    className="min-h-11 rounded-lg px-2 font-semibold text-danger" aria-label={`Remove photo ${photo.file.name}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </fieldset>
      <FormMessage error={error} success={notice} />
      <Button type="submit" disabled={busy}>{busy ? 'Sending…' : viewer === 'tenant' ? 'Report repair' : 'Log repair'}</Button>
    </form>
  );
}
