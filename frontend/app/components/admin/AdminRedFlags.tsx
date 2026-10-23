'use client';

import { useEffect, useRef, useState } from 'react';
import ComplaintsSectionNav from '@/app/components/admin/ComplaintsSectionNav';
import ReasonDialog from '@/app/components/admin/ReasonDialog';
import RedFlagRuleDialog from '@/app/components/admin/RedFlagRuleDialog';
import StatePill, { type PillTone } from '@/app/components/admin/StatePill';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FilterChip from '@/app/components/ui/FilterChip';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import Modal from '@/app/components/ui/Modal';
import PageHeader from '@/app/components/ui/PageHeader';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatDate, formatDateTime } from '@/app/lib/format';
import {
  FLAG_ACTION_LABELS,
  FLAG_PAGE_SIZE,
  FLAG_SEVERITY_LABELS,
  FLAG_STATUS_LABELS,
  redFlagsApi,
  ruleSummary,
  type FlagStatus,
  type RedFlagEvent,
  type RedFlagEventPage,
  type RedFlagRule,
} from '@/app/lib/red-flags-api';

type Flags = { key: string; page: RedFlagEventPage | null; error: string | null };
type Rules = { attempt: number; list: RedFlagRule[] | null; error: string | null };
type Message = { text: string; error: boolean };

const FILTERS: (FlagStatus | '')[] = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED', ''];
const STATUS_TONES: Record<FlagStatus, PillTone> = {
  OPEN: 'danger', ACKNOWLEDGED: 'warning', RESOLVED: 'success', DISMISSED: 'neutral',
};

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * The red flags (tracker R39). The database raises a flag when a rule's
 * count of complaints about one property is reached, and notifies the
 * admins with a link here. Admins acknowledge, resolve or dismiss each flag
 * (resolving and dismissing need a note; who and when are kept with the
 * evidence), and manage the rules: add, edit, switch off, re-evaluate now,
 * and delete one that never raised a flag.
 */
export default function AdminRedFlags() {
  const [status, setStatus] = useState<FlagStatus | ''>('OPEN');
  // The flags come FLAG_PAGE_SIZE at a time, newest first; a new filter starts at its first page.
  const [pageNumber, setPageNumber] = useState(1);
  const [flagsAttempt, setFlagsAttempt] = useState(0);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [rulesAttempt, setRulesAttempt] = useState(0);
  const [rules, setRules] = useState<Rules | null>(null);
  const [editing, setEditing] = useState<{ rule: RedFlagRule | null } | null>(null);
  const [deactivating, setDeactivating] = useState<RedFlagRule | null>(null);
  const [deleting, setDeleting] = useState<RedFlagRule | null>(null);
  const [deciding, setDeciding] = useState<{ event: RedFlagEvent; action: 'resolve' | 'dismiss' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const flagsKey = JSON.stringify([status, pageNumber, flagsAttempt]);
  const currentFlags = flags?.key === flagsKey ? flags : null;
  const currentRules = rules?.attempt === rulesAttempt ? rules : null;
  // A reload keeps the rules on screen, so an open dialog keeps its place.
  const ruleList = currentRules?.list ?? rules?.list ?? null;

  useEffect(() => {
    let active = true;
    redFlagsApi.events(status, pageNumber).then(
      (page) => { if (active) setFlags({ key: flagsKey, page, error: null }); },
      (error) => { if (active) setFlags({ key: flagsKey, page: null, error: errorText(error, 'Please try again.') }); },
    );
    return () => { active = false; };
  }, [flagsKey, status, pageNumber]);

  useEffect(() => {
    let active = true;
    redFlagsApi.rules().then(
      (list) => { if (active) setRules({ attempt: rulesAttempt, list, error: null }); },
      (error) => { if (active) setRules({ attempt: rulesAttempt, list: null, error: errorText(error, 'Please try again.') }); },
    );
    return () => { active = false; };
  }, [rulesAttempt]);

  useEffect(() => { if (message) focusResult(messageRef.current, pageRef.current); }, [message]);

  function done(text: string, { reloadFlags = false, reloadRules = false } = {}) {
    setMessage({ text, error: false });
    if (reloadFlags) setFlagsAttempt((value) => value + 1);
    if (reloadRules) setRulesAttempt((value) => value + 1);
  }

  function decided(event: RedFlagEvent, text: string) {
    setFlags((previous) => (previous?.page
      ? { ...previous, page: { ...previous.page, items: previous.page.items.map((item) => (item.id === event.id ? event : item)) } }
      : previous));
    // The counts on the rules, and the filtered list, come from the server.
    done(text, { reloadRules: true });
  }

  async function acknowledge(event: RedFlagEvent) {
    if (busy) return;
    setBusy(event.id);
    try {
      decided(await redFlagsApi.decide(event, 'acknowledge'), `${event.summary} was acknowledged.`);
    } catch (error) {
      setMessage({ text: errorText(error, 'The flag was not acknowledged. Please try again.'), error: true });
      if (error instanceof ApiError && error.status === 409) setFlagsAttempt((value) => value + 1);
    } finally {
      setBusy(null);
    }
  }

  async function evaluate(rule: RedFlagRule) {
    if (busy) return;
    setBusy(rule.id);
    try {
      const result = await redFlagsApi.evaluate(rule.id);
      done(
        result.created
          ? `${rule.name} opened ${result.created} new ${result.created === 1 ? 'flag' : 'flags'}.`
          : `${rule.name} found no property past its count without a flag already.`,
        { reloadFlags: true, reloadRules: true },
      );
    } catch (error) {
      setMessage({ text: errorText(error, 'The rule was not re-evaluated. Please try again.'), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function activate(rule: RedFlagRule) {
    if (busy) return;
    setBusy(rule.id);
    try {
      await redFlagsApi.setRuleActive(rule.id, true);
      done(`${rule.name} counts new complaints again.`, { reloadRules: true });
    } catch (error) {
      setMessage({ text: errorText(error, `${rule.name} was not activated. Please try again.`), error: true });
    } finally {
      setBusy(null);
    }
  }

  const page = currentFlags?.page;
  const totalPages = page ? Math.max(1, Math.ceil(page.total / FLAG_PAGE_SIZE)) : 1;
  const showPager = page && (totalPages > 1 || pageNumber > 1);
  return (
    <div ref={pageRef} className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Red flags"
        description="The database raises a flag when a rule's count of complaints about one property is reached, and tells every admin. Decide each flag here; the evidence stays with it."
        actions={ruleList ? <Button onClick={() => setEditing({ rule: null })}>New rule</Button> : undefined}
      />
      <ComplaintsSectionNav current="red-flags" />

      <div ref={messageRef} tabIndex={-1}>
        <FormMessage error={message?.error ? message.text : null} success={message && !message.error ? message.text : null} />
      </div>

      <section aria-labelledby="flags-heading" aria-busy={!currentFlags} className="min-w-0">
        <h2 id="flags-heading" className="font-heading text-h4 font-semibold text-text-dark">
          {page ? `${page.total} ${page.total === 1 ? 'flag' : 'flags'}` : 'Flags'}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter the flags">
          {FILTERS.map((value) => (
            <FilterChip key={value || 'all'} selected={status === value} onClick={() => { setStatus(value); setPageNumber(1); }}>
              {value ? FLAG_STATUS_LABELS[value] : 'All'}
            </FilterChip>
          ))}
        </div>
        {!currentFlags ? (
          <div role="status" aria-label="Loading the flags" className="mt-4 space-y-3">
            {[0, 1].map((index) => <div key={index} aria-hidden className="h-28 animate-pulse rounded-2xl border border-border bg-white" />)}
          </div>
        ) : !page ? (
          <div className="mt-4">
            <LoadErrorCard title="Couldn't load the flags" message={currentFlags.error ?? undefined} onRetry={() => setFlagsAttempt((value) => value + 1)} />
          </div>
        ) : page.items.length === 0 ? (
          <Card className="mt-4 p-6">
            <p className="text-sm text-text-body">
              {page.total ? 'No flags on this page.'
                : status ? `No ${FLAG_STATUS_LABELS[status].toLowerCase()} flags.` : 'No rule has raised a flag yet.'}
            </p>
          </Card>
        ) : (
          <ul className="mt-4 space-y-3">
            {page.items.map((event) => (
              <li key={event.id}>
                <FlagCard
                  event={event}
                  busy={busy === event.id}
                  onAcknowledge={() => acknowledge(event)}
                  onDecide={(action) => setDeciding({ event, action })}
                />
              </li>
            ))}
          </ul>
        )}
        {showPager ? (
          <nav aria-label="Flag pages" className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Button variant="secondary" size="sm" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => value - 1)}>
              ‹ Previous<span className="sr-only"> page of flags</span>
            </Button>
            <span className="text-sm text-text-body">Page {pageNumber} of {totalPages}</span>
            <Button variant="secondary" size="sm" disabled={pageNumber >= totalPages} onClick={() => setPageNumber((value) => value + 1)}>
              Next<span className="sr-only"> page of flags</span> ›
            </Button>
          </nav>
        ) : null}
      </section>

      <section aria-labelledby="rules-heading" aria-busy={!ruleList && !currentRules} className="min-w-0">
        <h2 id="rules-heading" className="font-heading text-h4 font-semibold text-text-dark">Rules</h2>
        {!ruleList && !currentRules ? (
          <div role="status" aria-label="Loading the rules" className="mt-3 space-y-3">
            <div aria-hidden className="h-24 animate-pulse rounded-2xl border border-border bg-white" />
          </div>
        ) : !ruleList ? (
          <div className="mt-3">
            <LoadErrorCard title="Couldn't load the rules" message={currentRules?.error ?? undefined} onRetry={() => setRulesAttempt((value) => value + 1)} />
          </div>
        ) : ruleList.length === 0 ? (
          <Card className="mt-3 p-6">
            <p className="text-sm text-text-body">No rules yet, so no complaint raises a flag. Add one to start.</p>
          </Card>
        ) : (
          <ul className="mt-3 space-y-3">
            {ruleList.map((rule) => (
              <li key={rule.id}>
                <RuleCard
                  rule={rule}
                  busy={busy === rule.id}
                  onEdit={() => setEditing({ rule })}
                  onEvaluate={() => evaluate(rule)}
                  onDeactivate={() => setDeactivating(rule)}
                  onActivate={() => activate(rule)}
                  onDelete={() => setDeleting(rule)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <RedFlagRuleDialog
        key={editing ? editing.rule?.id ?? 'new' : 'closed'}
        rule={editing?.rule ?? null}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(rule) => {
          const isNew = editing?.rule === null;
          setEditing(null);
          done(isNew ? `${rule.name} was added and counts new complaints.` : `${rule.name} was saved.`, { reloadRules: true });
        }}
        onStale={() => setRulesAttempt((value) => value + 1)}
        returnFocus={() => messageRef.current}
      />

      <ReasonDialog
        key={deactivating?.id ?? 'no-rule'}
        open={deactivating !== null}
        title={deactivating ? `Deactivate ${deactivating.name}` : 'Deactivate the rule'}
        effect={<p>It stops counting new complaints. The flags it raised stay, with their evidence, and you can activate it again.</p>}
        confirmLabel="Deactivate"
        reasonHelp="Kept in the audit log with your name and the time."
        onClose={() => setDeactivating(null)}
        onConfirm={async (reason) => {
          if (!deactivating) return null;
          try {
            await redFlagsApi.setRuleActive(deactivating.id, false, reason);
            const name = deactivating.name;
            setDeactivating(null);
            done(`${name} no longer counts new complaints.`, { reloadRules: true });
            return null;
          } catch (error) {
            return errorText(error, 'The rule was not deactivated. Please try again.');
          }
        }}
        returnFocus={() => messageRef.current}
      />

      <ReasonDialog
        key={deciding ? `${deciding.event.id}-${deciding.action}` : 'no-flag'}
        open={deciding !== null}
        title={deciding ? `${FLAG_ACTION_LABELS[deciding.action]} the flag` : 'Decide the flag'}
        effect={deciding ? (
          <p>
            {deciding.action === 'resolve'
              ? 'The flag closes as dealt with. '
              : 'The flag closes as not needing action. '}
            The evidence stays with it, and a new breach of the rule raises a new flag.
          </p>
        ) : null}
        confirmLabel={deciding ? FLAG_ACTION_LABELS[deciding.action] : 'Save'}
        tone={deciding?.action === 'resolve' ? 'primary' : 'destructive'}
        reasonHelp="Kept with the flag and in the audit log, with your name and the time."
        onClose={() => setDeciding(null)}
        onConfirm={async (note) => {
          if (!deciding) return null;
          try {
            const event = await redFlagsApi.decide(deciding.event, deciding.action, note);
            const text = `${deciding.event.summary} was ${deciding.action === 'resolve' ? 'resolved' : 'dismissed'}.`;
            setDeciding(null);
            decided(event, text);
            return null;
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) setFlagsAttempt((value) => value + 1);
            return errorText(error, 'The decision was not saved. Please try again.');
          }
        }}
        returnFocus={() => messageRef.current}
      />

      <DeleteRuleDialog
        rule={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(rule) => {
          setDeleting(null);
          done(`${rule.name} was deleted.`, { reloadRules: true });
        }}
        returnFocus={() => messageRef.current}
      />
    </div>
  );
}

function FlagCard({ event, busy, onAcknowledge, onDecide }: {
  event: RedFlagEvent; busy: boolean; onAcknowledge: () => void; onDecide: (action: 'resolve' | 'dismiss') => void;
}) {
  const evidence = event.evidence;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-words font-heading text-base font-semibold text-text-dark">{event.summary}</h3>
        <StatePill tone={STATUS_TONES[event.status]}>{FLAG_STATUS_LABELS[event.status]}</StatePill>
      </div>
      <p className="break-words text-sm text-text-body">
        {event.property_title ?? 'A property'}{event.address ? ` · ${event.address}` : ''}
      </p>
      <div className="rounded-xl bg-background p-3 text-sm text-text-body">
        <p className="font-semibold text-text-dark">Evidence</p>
        {evidence.details ? <p className="mt-1 break-words">{evidence.details}</p> : null}
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          <span>Raised <time dateTime={event.triggered_at}>{formatDateTime(event.triggered_at)}</time></span>
          {typeof evidence.thresholdCount === 'number' ? <span>Rule count {evidence.thresholdCount}</span> : null}
          {evidence.windowStart ? <span>Counted from {formatDate(evidence.windowStart)}</span> : null}
        </p>
        {event.complaint ? (
          <p className="mt-1">
            Latest complaint: {event.complaint.category_label}, lodged {formatDate(event.complaint.lodged_at)}
          </p>
        ) : null}
      </div>
      {event.decisions.length ? (
        <ol aria-label="Decisions" className="space-y-2 text-sm">
          {event.decisions.map((decision, index) => (
            <li key={`${decision.at}-${index}`} className="break-words text-text-body">
              <span className="text-text-dark">
                {decision.action ? decision.action[0].toUpperCase() + decision.action.slice(1) : 'Decided'} by {decision.actor_name ?? 'an admin'}
              </span>
              {decision.at ? <> · <time dateTime={decision.at}>{formatDateTime(decision.at)}</time></> : null}
              {decision.note ? <p className="mt-1 whitespace-pre-wrap rounded-lg bg-background px-3 py-2">{decision.note}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {event.actions.length ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {event.actions.includes('acknowledge') ? (
            <Button variant="secondary" size="sm" onClick={onAcknowledge} aria-disabled={busy || undefined}>
              {busy ? 'Saving…' : 'Acknowledge'}<span className="sr-only"> {event.summary}</span>
            </Button>
          ) : null}
          {event.actions.includes('resolve') ? (
            <Button size="sm" onClick={() => onDecide('resolve')}>Resolve<span className="sr-only"> {event.summary}</span></Button>
          ) : null}
          {event.actions.includes('dismiss') ? (
            <Button variant="ghost" size="sm" onClick={() => onDecide('dismiss')}>Dismiss<span className="sr-only"> {event.summary}</span></Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function RuleCard({ rule, busy, onEdit, onEvaluate, onDeactivate, onActivate, onDelete }: {
  rule: RedFlagRule; busy: boolean; onEdit: () => void; onEvaluate: () => void; onDeactivate: () => void;
  onActivate: () => void; onDelete: () => void;
}) {
  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="break-words font-heading text-base font-semibold text-text-dark">{rule.name}</span>
          <StatePill tone={rule.is_active ? 'success' : 'neutral'}>{rule.is_active ? 'Active' : 'Inactive'}</StatePill>
          <span className="min-w-0 break-all font-mono text-xs text-text-body">{rule.rule_key}</span>
        </p>
        {rule.description ? <p className="mt-1 break-words text-sm text-text-body">{rule.description}</p> : null}
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-body">
          <span>A flag at {ruleSummary(rule)}</span>
          <span>{FLAG_SEVERITY_LABELS[rule.severity]} severity</span>
          <span>{rule.active_flags} open · {rule.total_flags} raised</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onEdit}>Edit<span className="sr-only"> {rule.name}</span></Button>
        {rule.is_active ? (
          <>
            <Button variant="secondary" size="sm" onClick={onEvaluate} aria-disabled={busy || undefined}>
              {busy ? 'Checking…' : 'Re-evaluate now'}<span className="sr-only"> {rule.name}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={onDeactivate}>Deactivate<span className="sr-only"> {rule.name}</span></Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={onActivate} aria-disabled={busy || undefined}>
            Activate<span className="sr-only"> {rule.name}</span>
          </Button>
        )}
        {rule.total_flags === 0 ? (
          <Button variant="ghost" size="sm" onClick={onDelete}>Delete<span className="sr-only"> {rule.name}</span></Button>
        ) : null}
      </div>
    </Card>
  );
}

/** Deleting a rule that never raised a flag; one that did is kept, so its flags keep their evidence. */
function DeleteRuleDialog({ rule, onClose, onDeleted, returnFocus }: {
  rule: RedFlagRule | null; onClose: () => void; onDeleted: (rule: RedFlagRule) => void; returnFocus: () => HTMLElement | null;
}) {
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!rule || busy) return;
    setBusy(true);
    try {
      await redFlagsApi.deleteRule(rule.id);
      setError(null);
      onDeleted(rule);
    } catch (err) {
      setError({ id: rule.id, text: errorText(err, 'The rule was not deleted. Please try again.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={rule !== null} title={rule ? `Delete ${rule.name}` : 'Delete the rule'} onClose={onClose} busy={busy} returnFocus={returnFocus}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-body">It never raised a flag, so nothing else goes with it. The audit log keeps a record.</p>
        <FormMessage error={error && error.id === rule?.id ? error.text : null} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={remove} aria-disabled={busy || undefined}>{busy ? 'Deleting…' : 'Delete'}</Button>
        </div>
      </div>
    </Modal>
  );
}
