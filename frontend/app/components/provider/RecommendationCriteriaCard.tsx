'use client';

import { forwardRef, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import ProviderLocationAutocomplete from '@/app/components/provider/ProviderLocationAutocomplete';
import type { RecommendationCriteria } from '@/app/lib/api';
import { criteriaReady, missingCriteria, type ChatService } from '@/app/lib/recommendation-chat';

const ROLE_OPTIONS = [
  { value: 'landlord', label: 'Landlords' },
  { value: 'tenant', label: 'Tenants' },
  { value: 'any', label: 'Both' },
] as const;

type Props = {
  criteria: RecommendationCriteria;
  services: ChatService[];
  disabled: boolean;
  searching: boolean;
  onChange: (criteria: RecommendationCriteria) => void;
  onSearch: () => void;
};

/** What will be searched, editable by hand. The heading takes focus from "Adjust details". */
const RecommendationCriteriaCard = forwardRef<HTMLHeadingElement, Props>(function RecommendationCriteriaCard(
  { criteria, services, disabled, searching, onChange, onSearch },
  headingRef,
) {
  const ready = criteriaReady(criteria);
  const missing = missingCriteria(criteria);
  const anywhere = criteria.location === '';
  const role = criteria.role === 'tenant' || criteria.role === 'landlord' ? criteria.role : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ready && !disabled && !searching) onSearch();
  }

  function toggleService(id: string, checked: boolean) {
    const serviceIds = checked ? [...criteria.service_ids, id] : criteria.service_ids.filter((item) => item !== id);
    onChange({ ...criteria, service_ids: serviceIds.slice(0, 5) });
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 ref={headingRef} id="recommendation-criteria-heading" tabIndex={-1} className="font-heading text-lg font-semibold text-text-dark focus:outline-none">Search details</h2>
      <p className="mt-1 text-sm leading-6 text-text-body" role="status">
        {ready ? 'Ready to search. Check the details, then choose Find matches.' : `Still needed: ${missing.join(' and ')}. Tell the assistant or choose below.`}
      </p>

      <form onSubmit={submit} className="mt-5 space-y-5" aria-labelledby="recommendation-criteria-heading">
        <fieldset disabled={disabled}>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-body">People</legend>
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map((option) => (
              <label key={option.value} className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-strong forced-colors:has-[:checked]:outline-2 forced-colors:has-[:checked]:outline-offset-2 forced-colors:has-[:checked]:underline ${criteria.role === option.value ? 'border-primary-strong bg-primary-strong text-white' : 'border-border bg-white text-text-body'}`}>
                <input type="radio" name="recommendation-criteria-role" value={option.value} checked={criteria.role === option.value} onChange={() => onChange({ ...criteria, role: option.value })} className="sr-only" />
                {criteria.role === option.value ? <span aria-hidden="true">✓</span> : null}
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <ProviderLocationAutocomplete
            id="recommendation-criteria-location"
            value={criteria.location ?? ''}
            role={role}
            disabled={disabled || anywhere}
            describedBy="recommendation-criteria-location-help"
            onChange={(value) => onChange({ ...criteria, location: value.trim() ? value : null })}
            onSelect={(value) => onChange({ ...criteria, location: value })}
          />
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-text-body">
            <input type="checkbox" className="size-4 accent-primary-strong" checked={anywhere} disabled={disabled} onChange={(event) => onChange({ ...criteria, location: event.target.checked ? '' : null })} />
            Any area
          </label>
          <p id="recommendation-criteria-location-help" className="mt-1 text-xs leading-5 text-text-body">A suburb, postcode or state. Areas are matched on profile text; distances are not known.</p>
        </div>

        {services.length > 0 ? (
          <fieldset disabled={disabled}>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-body">Services to focus on</legend>
            <p className="mb-2 text-xs leading-5 text-text-body">Leave all unticked to use every active service.</p>
            <div className="space-y-1">
              {services.map((service) => {
                const checked = criteria.service_ids.includes(service.id);
                return (
                  <label key={service.id} className="flex min-h-11 items-center gap-2 text-sm text-text-dark">
                    <input type="checkbox" className="size-4 accent-primary-strong" checked={checked} disabled={!checked && criteria.service_ids.length >= 5} onChange={(event) => toggleService(service.id, event.target.checked)} />
                    <span className="break-words">{service.title}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <label className="flex min-h-11 items-center gap-2 text-sm text-text-dark">
          <input type="checkbox" className="size-4 accent-primary-strong" checked={criteria.new_only} disabled={disabled} onChange={(event) => onChange({ ...criteria, new_only: event.target.checked })} />
          Only people I&apos;m not connected with yet
        </label>

        <Button type="submit" fullWidth disabled={!ready || disabled} aria-disabled={searching}>{searching ? 'Finding matches…' : 'Find matches'}</Button>
        <p className="text-xs leading-5 text-text-body">Matches use member profile information, not confirmed requests for your services.</p>
      </form>
    </Card>
  );
});

export default RecommendationCriteriaCard;
