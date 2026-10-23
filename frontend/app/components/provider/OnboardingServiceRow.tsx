import type { ProviderService } from '@/app/lib/api';
import type { DraftService } from '@/app/lib/provider-workspace';
import { PRICING_OPTIONS } from '@/app/lib/provider-pricing';

type Props = {
  service: DraftService;
  index: number;
  invalid: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<DraftService>) => void;
  onRemove: () => void;
};

/**
 * One service in onboarding step 2. Each control has a label of its own, so
 * tapping a label's text only ever operates that control.
 */
export default function OnboardingServiceRow({ service, index, invalid, canRemove, onChange, onRemove }: Props) {
  const id = `onboarding-service-${index}`;
  const describedBy = invalid ? 'onboarding-service-error' : undefined;
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
      <input
        id={id}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        maxLength={80}
        value={service.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Service name"
        aria-label={`Service ${index + 1} name`}
        className="h-11 rounded-[14px] border border-control-border bg-[#fafafe] px-4 text-sm outline-none focus:border-primary"
      />
      <div className="relative">
        <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[#5f6b76]">
          $
        </span>
        <input
          id={`${id}-price`}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          value={service.price}
          onChange={(e) => onChange({ price: e.target.value })}
          placeholder="99"
          inputMode="decimal"
          aria-label={`Service ${index + 1} price`}
          className="h-11 w-full rounded-[14px] border border-control-border bg-[#fafafe] py-2 pr-3 pl-7 text-sm outline-none focus:border-primary"
        />
      </div>
      <label className="block text-xs text-text-muted sm:col-span-3">
        What clients get (needed to enable the service)
        <textarea
          id={`${id}-description`}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          rows={2}
          maxLength={1000}
          value={service.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="e.g. Bond-back clean: kitchen, bathrooms, windows and carpets."
          aria-label={`Service ${index + 1} description`}
          className="mt-1 w-full rounded-[14px] border border-control-border bg-[#fafafe] px-4 py-2 text-sm text-text-dark outline-none focus:border-primary"
        />
      </label>
      <div className="space-y-1 sm:col-span-2">
        <label className="block text-xs text-text-muted">
          Pricing type
          <select aria-label={`Service ${index + 1} pricing type`} value={service.pricing_type ?? 'flat'} onChange={(e) => onChange({ pricing_type: e.target.value as ProviderService['pricing_type'] })} className="ml-2 min-h-11 rounded border border-control-border p-2">
            {PRICING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm text-text-dark">
          <input type="checkbox" checked={service.is_active !== false} onChange={(e) => onChange({ is_active: e.target.checked })} className="size-5 shrink-0" />
          <span>Enable service on my public profile<span className="sr-only">, service {index + 1}</span></span>
        </label>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`Remove service ${index + 1}`}
        className="min-h-11 rounded-lg border border-control-border px-3 text-sm font-semibold text-[#b42318] hover:bg-[#fdecee] disabled:cursor-not-allowed disabled:opacity-30"
      >
        Remove
      </button>
    </div>
  );
}
