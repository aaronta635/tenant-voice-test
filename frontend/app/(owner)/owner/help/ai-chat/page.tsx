'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import DemoLabel from '@/app/components/demo/DemoLabel';
import ActionPreview, { type ActionState } from '@/app/components/owner/assistant/ActionPreview';
import ActionReceipt from '@/app/components/owner/assistant/ActionReceipt';
import ProviderSuggestions from '@/app/components/owner/assistant/ProviderSuggestions';
import VerificationRequired from '@/app/components/trust/VerificationRequired';
import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import { BotIcon } from '@/app/components/owner/icons';
import { api, ApiError } from '@/app/lib/api';
import {
  historyTurns,
  newRequestId,
  replyKind,
  type OwnerAiStatus,
  type OwnerAssistantAction,
  type OwnerAssistantConfirmation,
  type ProviderSuggestion,
} from '@/app/lib/owner-assistant';
import { refusalOf, verificationRequired, type VerificationRequiredDetail } from '@/app/lib/verification-gate';

type Turn = {
  key: string;
  question: string;
  reply: string;
  /** Set for the answers this visit asked for; the history does not say what wrote a reply. */
  source?: 'ai' | 'rules';
  requestId?: string;
  action?: OwnerAssistantAction | null;
  providers?: ProviderSuggestion[];
};

/** The element that replaces a turn's action preview: its receipt, or the cancelled note. */
const outcomeId = (key: string) => `action-outcome-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;

/** Where a proposed action stands: confirmed (with what it saved), cancelled, or still open. */
type ActionView =
  | { state: ActionState; error?: string; gate?: VerificationRequiredDetail | null }
  | { state: 'done'; outcome: OwnerAssistantConfirmation }
  | { state: 'cancelled' };

const PILL = 'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold';

function ReplyLabel({ reply, source }: { reply: string; source?: 'ai' | 'rules' }) {
  const kind = replyKind(reply, source);
  if (kind === 'ai') return <span className={`${PILL} border-primary-strong bg-white text-primary-strong`}>AI answer</span>;
  if (kind === 'rules') return <span className={`${PILL} border-warning bg-white text-text-dark`}>AI unavailable</span>;
  if (kind === 'saved-data') return <DemoLabel reason="saved owner-assistant data, not an AI answer" />;
  return null;
}

/** Says who answers: the model, or the rules and why (no model, or the paid_ai gate). */
function AiNotice({ status, gate }: { status: OwnerAiStatus | null; gate: VerificationRequiredDetail | null }) {
  if (status === 'ready') {
    return (
      <p role="note" className="rounded-xl border border-primary/20 bg-white px-4 py-3 text-sm text-text-body">
        Answers come from an AI model reading your listings, applications, repairs and records, and it can be wrong.
        It explains but never chooses an applicant, and nothing changes until you confirm a suggested action.
      </p>
    );
  }
  if (status !== 'not_configured' && status !== 'verification_required') return null;
  return (
    <div role="note" className="flex flex-col gap-3 rounded-xl border border-warning bg-white px-4 py-3 text-sm text-text-body">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${PILL} border-warning bg-white text-text-dark`}>AI unavailable</span>
        <p className="min-w-0 grow basis-48">
          {status === 'not_configured'
            ? 'No AI model is connected, so answers are worked out by fixed rules from your records.'
            : 'Until your account is verified, answers are worked out by fixed rules from your records.'}
        </p>
      </div>
      {gate ? <VerificationRequired detail={gate} /> : null}
    </div>
  );
}

/**
 * The owner assistant (R29-R31). The history is shared with the mobile app.
 * A question gets the model's answer when a model is connected and the
 * account is verified (the paid AI, R18), and the rules' answer otherwise,
 * labelled "AI unavailable". An action the model suggests shows as a
 * preview: Cancel sends nothing, Confirm runs exactly that action and shows
 * the record it saved.
 */
export default function AiChatSupportPage() {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [actions, setActions] = useState<Record<string, ActionView>>({});
  const [loading, setLoading] = useState(true);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [aiStatus, setAiStatus] = useState<OwnerAiStatus | null>(null);
  const [aiGate, setAiGate] = useState<VerificationRequiredDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<VerificationRequiredDetail | null>(null);
  const gateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const workspace = await api.ownerAssistant.workspace();
        if (!active) return;
        setTurns(historyTurns(workspace.history).map((turn, index) => ({ ...turn, key: `history-${index}` })));
        setAiStatus(workspace.ai_status ?? null);
        setAiGate(refusalOf(workspace.verification));
      } catch {
        if (active) setHistoryFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function setAction(key: string, view: ActionView) {
    setActions((current) => ({ ...current, [key]: view }));
  }

  /** The preview's buttons go away with it: focus moves to what replaced them, as for the gate notice. */
  function focusOutcome(key: string) {
    requestAnimationFrame(() => document.getElementById(outcomeId(key))?.focus());
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setGate(null);
    try {
      const requestId = newRequestId();
      const answer = await api.ownerAssistant.ask(text, requestId);
      setTurns((current) => [...current, {
        key: answer.request_id || requestId, question: answer.question, reply: answer.reply, source: answer.source,
        requestId: answer.request_id || requestId, action: answer.action, providers: answer.providers ?? [],
      }]);
      if (answer.ai_status === 'verification_required') {
        setAiStatus('verification_required');
        setAiGate(refusalOf(answer.verification));
      } else if (answer.ai_status === 'not_configured') {
        setAiStatus('not_configured');
      }
      setQuestion('');
    } catch (err) {
      const refusal = verificationRequired(err);
      if (refusal) {
        setGate(refusal);
        requestAnimationFrame(() => gateRef.current?.focus());
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not reach the owner assistant.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirm(turn: Turn) {
    if (!turn.requestId) return;
    setAction(turn.key, { state: 'confirming' });
    try {
      // The saved history now ends the turn with the receipt; here it shows below the model's reply.
      setAction(turn.key, { state: 'done', outcome: await api.ownerAssistant.confirm(turn.requestId) });
      focusOutcome(turn.key);
    } catch (err) {
      setAction(turn.key, {
        state: 'failed',
        gate: verificationRequired(err),
        error: err instanceof ApiError ? err.message : 'Could not reach the owner assistant.',
      });
    }
  }

  return (
    <Card className="flex min-h-[480px] flex-col overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-full bg-primary text-white">
            <BotIcon size={20} />
          </div>
          <h1 className="font-heading text-lg font-semibold text-text-dark">Owner assistant</h1>
        </div>
        <Link href="/owner/help" className="text-sm font-medium text-primary-strong hover:underline">
          Back to Help & Contact
        </Link>
      </div>
      <div className="flex flex-1 flex-col gap-4 bg-background/40 px-4 py-6 sm:px-6">
        <AiNotice status={aiStatus} gate={aiGate} />
        <div role="log" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto">
          {loading ? (
            <p role="status" className="text-sm text-text-body">Loading your conversation…</p>
          ) : turns.length === 0 ? (
            <p className="text-sm text-text-body">
              {historyFailed ? 'Your earlier questions could not be loaded. You can still ask. ' : ''}
              Ask about your listings, rent, repairs, applications or service providers.
            </p>
          ) : (
            <>
              {historyFailed ? (
                <p className="text-sm text-text-body">Your earlier questions could not be loaded.</p>
              ) : null}
              {turns.map((turn) => {
                const view = actions[turn.key];
                return (
                  <div key={turn.key} className="space-y-2">
                    <div className="rounded-2xl border border-border bg-white px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-text-body">You</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-dark">{turn.question}</p>
                    </div>
                    <div className="rounded-2xl border border-primary/20 bg-[#eeeffd] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary-strong">Owner assistant</p>
                        <ReplyLabel reply={turn.reply} source={turn.source} />
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-dark">{turn.reply}</p>
                      <ProviderSuggestions providers={turn.providers ?? []} />
                      {turn.action && view?.state === 'done' ? <ActionReceipt outcome={view.outcome} id={outcomeId(turn.key)} /> : null}
                      {turn.action && view?.state === 'cancelled' ? (
                        <p id={outcomeId(turn.key)} tabIndex={-1} role="status" className="mt-3 text-sm text-text-body">
                          Cancelled. Nothing was changed.
                        </p>
                      ) : null}
                      {turn.action && (!view || view.state === 'pending' || view.state === 'confirming' || view.state === 'failed') ? (
                        <ActionPreview
                          action={turn.action}
                          state={view?.state ?? 'pending'}
                          error={view && 'error' in view ? view.error : null}
                          gate={view && 'gate' in view ? view.gate : null}
                          onConfirm={() => confirm(turn)}
                          onCancel={() => { setAction(turn.key, { state: 'cancelled' }); focusOutcome(turn.key); }}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        {gate ? (
          <div ref={gateRef} tabIndex={-1}>
            <VerificationRequired detail={gate} />
          </div>
        ) : null}
        <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input
            label="Question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="How many open applications do I have?"
            maxLength={2000}
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            {busy ? 'Asking…' : 'Ask'}
          </Button>
        </form>
      </div>
    </Card>
  );
}
