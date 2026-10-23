'use client';

import { useId, useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Modal from '@/app/components/ui/Modal';
import {
  adminComplaintsApi,
  codeFromName,
  POLICY_LIMITS,
  POLICY_SEVERITY_LABELS,
  splitWords,
  type CategoryFields,
  type CodeChoice,
  type IssueCategory,
  type PolicySeverity,
} from '@/app/lib/admin-complaints-api';
import { ApiError } from '@/app/lib/api';

type Props = {
  /** The policy to edit, or null for a new one. Give the dialog a key per policy. */
  category: IssueCategory | null;
  /** The complaint category codes a policy can cover. */
  codes: CodeChoice[];
  open: boolean;
  onClose: () => void;
  onSaved: (category: IssueCategory) => void;
  /** An edit was refused with 409 (someone changed it since): the list reloads. */
  onStale: () => void;
  returnFocus?: () => HTMLElement | null;
};

const FIELD = 'min-h-11 w-full min-w-0 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong';
const LABEL = 'text-xs font-semibold uppercase tracking-wide text-text-body';
const GROUPS: { title: string; kinds: CodeChoice['kind'][] }[] = [
  { title: 'Complaints', kinds: ['general', 'both'] },
  { title: 'Repairs only', kinds: ['repair'] },
];

/** The codes of the list a policy covers, in the list's order. */
function coveredCodes(category: IssueCategory | null, codes: CodeChoice[]) {
  const held = new Set((category?.source_categories ?? []).map((value) => value.toUpperCase()));
  return codes.filter((choice) => held.has(choice.code)).map((choice) => choice.code);
}

/**
 * Every field of a new or edited alert policy, as mobile_admin_save_issue_category
 * takes them; the database gives a new one its code from the name, and the
 * codes it covers are chosen from the fixed complaint categories.
 */
export default function CategoryFormDialog({ category, codes, open, onClose, onSaved, onStale, returnFocus }: Props) {
  const id = useId();
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [severity, setSeverity] = useState<PolicySeverity>(category?.severity ?? 'NORMAL');
  const [hours, setHours] = useState(String(category?.sla_hours ?? 72));
  const [team, setTeam] = useState(category?.routing_team ?? 'Complaint Resolution Team');
  const [covered, setCovered] = useState<string[]>(() => coveredCodes(category, codes));
  const [keywords, setKeywords] = useState((category?.keywords ?? []).join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function problem(): string | null {
    const trimmed = name.trim();
    if (trimmed.length < POLICY_LIMITS.nameMin || trimmed.length > POLICY_LIMITS.nameMax) {
      return `Give the policy a name of ${POLICY_LIMITS.nameMin} to ${POLICY_LIMITS.nameMax} characters.`;
    }
    if (description.trim().length > POLICY_LIMITS.description) return `Keep the description to ${POLICY_LIMITS.description} characters.`;
    const sla = Number(hours);
    if (!Number.isInteger(sla) || sla < 1 || sla > POLICY_LIMITS.slaMax) {
      return `Give the response time as a whole number of hours, from 1 to ${POLICY_LIMITS.slaMax}.`;
    }
    const length = team.trim().length;
    if (length < POLICY_LIMITS.teamMin || length > POLICY_LIMITS.teamMax) {
      return `Name the team in ${POLICY_LIMITS.teamMin} to ${POLICY_LIMITS.teamMax} characters.`;
    }
    return null;
  }

  function toggle(code: string) {
    setCovered((previous) => (previous.includes(code)
      ? previous.filter((value) => value !== code)
      : codes.map((choice) => choice.code).filter((value) => value === code || previous.includes(value))));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const invalid = problem();
    if (invalid) {
      setError(invalid);
      return;
    }
    const fields: CategoryFields = {
      name: name.trim(),
      description: description.trim(),
      severity,
      sla_hours: Number(hours),
      routing_team: team.trim(),
      source_categories: covered,
      keywords: splitWords(keywords),
    };
    setBusy(true);
    setError(null);
    try {
      if (category) {
        const before: CategoryFields = {
          name: category.name, description: category.description, severity: category.severity ?? 'NORMAL',
          sla_hours: category.sla_hours ?? 0, routing_team: category.routing_team ?? '',
          source_categories: coveredCodes(category, codes), keywords: category.keywords,
        };
        const changes = Object.fromEntries(
          Object.entries(fields).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof CategoryFields])),
        ) as Partial<CategoryFields>;
        onSaved(Object.keys(changes).length ? await adminComplaintsApi.updateCategory(category, changes) : category);
      } else {
        onSaved(await adminComplaintsApi.createCategory(fields));
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : 'The policy was not saved. Please try again.');
      if (category && err instanceof ApiError && err.status === 409) onStale();
    }
  }

  const suggested = codeFromName(name);
  return (
    <Modal
      open={open}
      title={category ? `Edit ${category.name}` : 'New alert policy'}
      onClose={onClose}
      busy={busy}
      returnFocus={returnFocus}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-name`} className={LABEL}>Name</label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={POLICY_LIMITS.nameMax}
            required
            aria-describedby={`${id}-code`}
            onChange={(event) => setName(event.target.value)}
            className={FIELD}
          />
          <p id={`${id}-code`} className="break-all text-xs text-text-body">
            {category
              ? <>Code <span className="font-mono">{category.code}</span>, which never changes.</>
              : suggested
                ? <>Its code will be <span className="font-mono">{suggested}</span>, from the name.</>
                : 'Its code comes from the name.'}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-description`} className={LABEL}>Description (optional)</label>
          <textarea
            id={`${id}-description`}
            value={description}
            maxLength={POLICY_LIMITS.description}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor={`${id}-severity`} className={LABEL}>Severity</label>
            <select id={`${id}-severity`} value={severity} onChange={(event) => setSeverity(event.target.value as PolicySeverity)} className={FIELD}>
              {(Object.entries(POLICY_SEVERITY_LABELS) as [PolicySeverity, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor={`${id}-hours`} className={LABEL}>Respond within (hours)</label>
            <input
              id={`${id}-hours`}
              type="number"
              inputMode="numeric"
              min={1}
              max={POLICY_LIMITS.slaMax}
              step={1}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              className={FIELD}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-team`} className={LABEL}>Team</label>
          <input id={`${id}-team`} value={team} maxLength={POLICY_LIMITS.teamMax} onChange={(event) => setTeam(event.target.value)} className={FIELD} />
        </div>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className={LABEL}>Complaint categories it covers</legend>
          {GROUPS.map((group) => {
            const choices = codes.filter((choice) => group.kinds.includes(choice.kind));
            if (!choices.length) return null;
            return (
              <div key={group.title} className="min-w-0">
                <p className="text-xs text-text-body">{group.title}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {choices.map((choice) => (
                    <label key={choice.code} className="flex min-h-11 items-center gap-2 text-sm text-text-dark">
                      <input
                        type="checkbox"
                        checked={covered.includes(choice.code)}
                        onChange={() => toggle(choice.code)}
                        className="size-4 accent-primary-strong"
                      />
                      {choice.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </fieldset>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-keywords`} className={LABEL}>Keywords (optional)</label>
          <input id={`${id}-keywords`} value={keywords} aria-describedby={`${id}-keywords-help`} onChange={(event) => setKeywords(event.target.value)} className={FIELD} />
          <p id={`${id}-keywords-help`} className="text-xs text-text-body">
            Words in a complaint&apos;s description that this policy covers, separated by commas. Left empty, the
            words of the name with 4 letters or more are used.
          </p>
        </div>
        <p className="text-xs text-text-body">
          An unresolved complaint it covers raises an admin alert once it passes the response time. Both apps share
          the policy, and each change is recorded with your name and the time.
        </p>
        <FormMessage error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" aria-disabled={busy || undefined}>{busy ? 'Saving…' : category ? 'Save changes' : 'Add policy'}</Button>
        </div>
      </form>
    </Modal>
  );
}
