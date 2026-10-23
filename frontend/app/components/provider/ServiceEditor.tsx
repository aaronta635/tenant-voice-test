'use client';

import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type ProviderService, type ProviderServiceInput } from '@/app/lib/api';

import Modal from '@/app/components/ui/Modal';
import FormMessage from '@/app/components/ui/FormMessage';
import { parseServiceAmount, SERVICE_LIMITS, serviceProblem } from '@/app/lib/provider-workspace';
import { clientPricePreview, PRICING_OPTIONS, pricingOption } from '@/app/lib/provider-pricing';
import { REPAIR_CATEGORIES, type RepairCategory } from '@/app/lib/repair-categories';

type Props = {
  /** Existing service to edit; omit to create a new one. */
  service?: ProviderService | null;
  onClose: () => void;
  onSaved: (service: ProviderService) => void;
};

const fieldClass =
  'mt-1.5 w-full rounded-[12px] border border-control-border bg-[#fafafe] px-3 py-2.5 text-sm text-[#1b1b1f] outline-none focus:border-primary focus:bg-white';
const labelClass = 'block text-xs font-bold tracking-wide text-[#5f6b76] uppercase';

/** Create / edit one service: every field the public profile and BookingCard show. */
export default function ServiceEditor({ service, onClose, onSaved }: Props) {
  const editing = !!service;
  const [title, setTitle] = useState(service?.title ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [pricingType, setPricingType] = useState<ProviderService['pricing_type']>(
    service?.pricing_type ?? 'flat',
  );
  const [price, setPrice] = useState(service ? String(service.price) : '');
  const [category, setCategory] = useState<RepairCategory>((service?.category as RepairCategory | undefined) ?? 'GENERAL');
  const [duration, setDuration] = useState(service?.duration_minutes ? String(service.duration_minutes) : '');
  const [area, setArea] = useState(service?.service_area ?? '');
  const [inclusions, setInclusions] = useState(service?.inclusions ?? '');
  const [exclusions, setExclusions] = useState(service?.exclusions ?? '');
  const [policy, setPolicy] = useState(service?.cancellation_policy ?? '');
  const [publish, setPublish] = useState(service?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const priceRef = useRef<HTMLInputElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const firstField = useRef<HTMLInputElement>(null);

  const preview = clientPricePreview(price, pricingType);

  const [initial] = useState(() => JSON.stringify([title, description, pricingType, price, category, duration, area, inclusions, exclusions, policy, publish]));
  const dirty = JSON.stringify([title, description, pricingType, price, category, duration, area, inclusions, exclusions, policy, publish]) !== initial;
  function requestClose() {
    if (saving) return;
    if (dirty) { setConfirmDiscard(true); return; }
    onClose();
  }

  function validate(): string | null {
    // The shared rules (mobile_service_validate): the server applies them again.
    const basic = serviceProblem(title, price, { active: publish });
    const problem = basic ?? serviceProblem(title, price, { description, active: publish });
    if (problem) {
      const name = title.trim();
      const field = basic ? (!name || name.length > SERVICE_LIMITS.title ? 'title' : 'price') : 'description';
      setInvalidField(field);
      ({ title: firstField, price: priceRef, description: descriptionRef }[field].current as HTMLElement | null)?.focus();
      return problem;
    }
    if (duration.trim()) {
      const minutes = Number(duration);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
        setInvalidField('duration');
        durationRef.current?.focus();
        return 'Duration must be a whole number of minutes between 5 and 1440.';
      }
    }
    setInvalidField(null);
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const payload: ProviderServiceInput = {
      title: title.trim(),
      description: description.trim() || null,
      pricing_type: pricingType,
      price: parseServiceAmount(price),
      category,
      duration_minutes: duration.trim() ? Number(duration) : null,
      service_area: area.trim() || null,
      inclusions: inclusions.trim() || null,
      exclusions: exclusions.trim() || null,
      cancellation_policy: policy.trim() || null,
      is_active: publish,
    };
    try {
      const saved = editing
        ? await api.providers.updateService(service.id, payload)
        : await api.providers.createService(payload);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this service.');
      setSaving(false);
    }
  }

  return (
    <Modal open title={editing ? 'Edit service' : 'Add a service'} onClose={requestClose} busy={saving} className="max-w-2xl">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="w-full"
      >
        <p className="mt-1 text-sm text-[#5f6b76]">
          Clients see enabled services after your provider profile is published.
        </p>

        <fieldset disabled={saving} className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>
            Service name
            <input
              ref={firstField}
              autoFocus
              aria-invalid={invalidField === "title"}
              aria-describedby={invalidField === "title" ? "service-editor-error" : undefined}
              required
              maxLength={SERVICE_LIMITS.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Rental appraisal"
              className={fieldClass}
            />
          </label>

          <label className={`${labelClass} sm:col-span-2`}>
            Description
            <textarea
              ref={descriptionRef}
              rows={3}
              maxLength={SERVICE_LIMITS.description}
              aria-invalid={invalidField === "description"}
              aria-describedby={invalidField === "description" ? "service-editor-error" : undefined}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the client gets and how the job runs."
              className={fieldClass}
            />
          </label>

          <label className={`${labelClass} sm:col-span-2`}>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value as RepairCategory)} className={fieldClass}>
              {REPAIR_CATEGORIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-[#5f6b76]">
              The kind of repair this service covers, as the mobile app lists it.
            </span>
          </label>

          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>Pricing</legend>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
              {PRICING_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`focus-within:ring-2 focus-within:ring-primary-strong focus-within:ring-offset-2 cursor-pointer rounded-[12px] border px-3 py-2.5 text-sm ${
                    pricingType === option.value
                      ? 'border-primary bg-[#eeeffd]'
                      : 'border-control-border bg-[#fafafe]'
                  }`}
                >
                  <input
                    type="radio"
                    name="pricing_type"
                    value={option.value}
                    checked={pricingType === option.value}
                    onChange={() => setPricingType(option.value)}
                    className="sr-only"
                  />
                  <span className="block font-semibold text-[#1b1b1f]">{option.label}</span>
                  <span className="block text-xs text-[#5f6b76]">{option.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className={labelClass}>
              {pricingOption(pricingType).amountLabel}
              <input
                required
                ref={priceRef}
                aria-invalid={invalidField === "price"}
                aria-describedby={invalidField === "price" ? "service-editor-error service-price-preview" : "service-price-preview"}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="99"
                className={fieldClass}
              />
            </label>
            {/* The price on the terms every card and page shows it. */}
            <p id="service-price-preview" className="mt-1.5 text-xs text-[#5f6b76]">
              {preview ? `Clients see: ${preview}` : 'Clients see the price once you enter one.'}
            </p>
          </div>

          <label className={labelClass}>
            Typical duration (minutes)
            <input
              ref={durationRef}
              aria-invalid={invalidField === "duration"}
              aria-describedby={invalidField === "duration" ? "service-editor-error" : undefined}
              inputMode="numeric"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="60"
              className={fieldClass}
            />
          </label>

          <label className={`${labelClass} sm:col-span-2`}>
            Service area
            <input
              maxLength={SERVICE_LIMITS.area}
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. Inner West and Eastern Suburbs"
              className={fieldClass}
            />
          </label>

          <label className={labelClass}>
            What’s included
            <textarea
              rows={3}
              maxLength={2000}
              value={inclusions}
              onChange={(e) => setInclusions(e.target.value)}
              className={fieldClass}
            />
          </label>

          <label className={labelClass}>
            Not included
            <textarea
              rows={3}
              maxLength={2000}
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              className={fieldClass}
            />
          </label>

          <label className={`${labelClass} sm:col-span-2`}>
            Cancellation policy
            <textarea
              rows={2}
              maxLength={2000}
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
              placeholder="e.g. Free cancellation up to 24 hours before the visit."
              className={fieldClass}
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-[#1b1b1f] sm:col-span-2">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
              className="size-4 accent-primary"
            />
            Show this service on my public profile
          </label>
        </fieldset>

        <div id="service-editor-error" className="mt-4"><FormMessage error={error} /></div>
        {confirmDiscard ? <div className="mt-4 rounded-xl border border-warning p-4" role="alert">
          <p className="font-semibold">Discard unsaved changes?</p>
          <div className="mt-3 flex gap-2"><button type="button" autoFocus onClick={() => setConfirmDiscard(false)} className="min-h-11 rounded-lg border px-4">Keep editing</button><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-danger px-4 text-danger">Discard changes</button></div>
        </div> : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={requestClose}
            disabled={saving}
            className="min-h-11 rounded-lg border border-control-border px-4 text-sm font-semibold text-[#5f6b76]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded-lg bg-primary-strong px-5 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add service'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
