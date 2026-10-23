'use client';

import { useId, useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Modal from '@/app/components/ui/Modal';
import { ApiError } from '@/app/lib/api';
import {
  FLAG_SEVERITY_LABELS,
  redFlagsApi,
  RULE_LIMITS,
  ruleSummary,
  type FlagSeverity,
  type RedFlagRule,
  type RuleFields,
  type TriggerMode,
} from '@/app/lib/red-flags-api';

type Props = {
  /** The rule to edit, or null for a new one. Give the dialog a key per rule. */
  rule: RedFlagRule | null;
  open: boolean;
  onClose: () => void;
  onSaved: (rule: RedFlagRule) => void;
  /** An edit was refused with 409 (someone changed it since): the list reloads. */
  onStale: () => void;
  returnFocus?: () => HTMLElement | null;
};

const FIELD = 'min-h-11 w-full min-w-0 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong';
const LABEL = 'text-xs font-semibold uppercase tracking-wide text-text-body';

function wholeNumber(text: string, max: number) {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

/** A red-flag rule's fields: how many complaints about one property, counted in total or within a window, raise a flag. */
export default function RedFlagRuleDialog({ rule, open, onClose, onSaved, onStale, returnFocus }: Props) {
  const id = useId();
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [threshold, setThreshold] = useState(String(rule?.threshold_count ?? 3));
  const [mode, setMode] = useState<TriggerMode>(rule?.trigger_mode ?? 'WINDOW');
  const [windowDays, setWindowDays] = useState(String(rule?.window_days ?? 30));
  const [severity, setSeverity] = useState<FlagSeverity>(rule?.severity ?? 'HIGH');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const count = wholeNumber(threshold, RULE_LIMITS.thresholdMax);
  const days = wholeNumber(windowDays, RULE_LIMITS.windowMax);

  function problem(): string | null {
    if (name.trim().length < 3) return 'Give the rule a name of at least 3 characters.';
    if (count === null) return `Give the number of complaints as a whole number from 1 to ${RULE_LIMITS.thresholdMax}.`;
    if (mode === 'WINDOW' && days === null) return `Give the window as a whole number of days from 1 to ${RULE_LIMITS.windowMax}.`;
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const invalid = problem();
    if (invalid) {
      setError(invalid);
      return;
    }
    const fields: RuleFields = {
      name: name.trim(),
      description: description.trim(),
      threshold_count: count ?? 3,
      trigger_mode: mode,
      // A total rule keeps its window for a later switch back.
      window_days: days ?? rule?.window_days ?? 30,
      severity,
    };
    setBusy(true);
    setError(null);
    try {
      if (rule) {
        const changes = Object.fromEntries(
          Object.entries(fields).filter(([key, value]) => value !== rule[key as keyof RuleFields]),
        ) as Partial<RuleFields>;
        onSaved(Object.keys(changes).length ? await redFlagsApi.updateRule(rule, changes) : rule);
      } else {
        onSaved(await redFlagsApi.createRule(fields));
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : 'The rule was not saved. Please try again.');
      if (rule && err instanceof ApiError && err.status === 409) onStale();
    }
  }

  return (
    <Modal open={open} title={rule ? `Edit ${rule.name}` : 'New red-flag rule'} onClose={onClose} busy={busy} returnFocus={returnFocus}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-name`} className={LABEL}>Name</label>
          <input id={`${id}-name`} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className={FIELD} />
          {rule ? <p className="break-all text-xs text-text-body">Key <span className="font-mono">{rule.rule_key}</span>, which never changes.</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-description`} className={LABEL}>Description (optional)</label>
          <textarea
            id={`${id}-description`}
            value={description}
            maxLength={500}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor={`${id}-threshold`} className={LABEL}>Complaints about one property</label>
            <input
              id={`${id}-threshold`}
              type="number"
              inputMode="numeric"
              min={1}
              max={RULE_LIMITS.thresholdMax}
              step={1}
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              className={FIELD}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor={`${id}-severity`} className={LABEL}>Severity</label>
            <select id={`${id}-severity`} value={severity} onChange={(event) => setSeverity(event.target.value as FlagSeverity)} className={FIELD}>
              {(Object.entries(FLAG_SEVERITY_LABELS) as [FlagSeverity, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-mode`} className={LABEL}>Counted</label>
          <select id={`${id}-mode`} value={mode} onChange={(event) => setMode(event.target.value as TriggerMode)} className={`${FIELD} sm:max-w-xs`}>
            <option value="WINDOW">Within a window of days</option>
            <option value="TOTAL">In total, ever</option>
          </select>
        </div>
        {mode === 'WINDOW' ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-window`} className={LABEL}>Window (days)</label>
            <input
              id={`${id}-window`}
              type="number"
              inputMode="numeric"
              min={1}
              max={RULE_LIMITS.windowMax}
              step={1}
              value={windowDays}
              onChange={(event) => setWindowDays(event.target.value)}
              className={`${FIELD} sm:max-w-xs`}
            />
          </div>
        ) : null}
        <p className="text-sm text-text-body">
          {count !== null && (mode === 'TOTAL' || days !== null)
            ? `A flag is raised at ${ruleSummary({ threshold_count: count, trigger_mode: mode, window_days: days ?? 30 })}, whatever their categories. Admins are notified.`
            : 'A flag is raised once a property reaches the count. Admins are notified.'}
        </p>
        <FormMessage error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" aria-disabled={busy || undefined}>{busy ? 'Saving…' : rule ? 'Save changes' : 'Add rule'}</Button>
        </div>
      </form>
    </Modal>
  );
}
