'use client';

import { Fragment, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import WithinPageLink from '@/app/components/public/WithinPageLink';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import { mergeClasses } from '@/app/components/ui/merge-classes';
import { ApiError } from '@/app/lib/api';
import {
  SUGGESTED_QUESTIONS,
  SUPPORT_MESSAGE_LIMIT,
  aiUnavailable,
  answerParts,
  answerRefusal,
  askSupport,
  historyContent,
  plainAnswer,
  resetTime,
  safeInternalHref,
  supportHistory,
  supportLimit,
  type SupportAnswer,
  type SupportAudience,
  type SupportLimit,
  type SupportSource,
  type SupportTurn,
} from '@/app/lib/support-chat';

type Turn =
  | { id: number; role: 'user'; content: string }
  | { id: number; role: 'assistant'; answer: SupportAnswer };

type Props = {
  /** Picks the example questions; the server answers for the signed-in account's role. */
  audience?: SupportAudience;
  className?: string;
};

const LINK_CLASS = 'font-semibold text-primary-strong underline';
const WAITING = 'Looking through the help pages…';

/**
 * The support chat (tracker R37) for a role's help page: a member asks how
 * something on TenantVoice works and the answer comes from its help pages,
 * written by AI when the account may use it, else the matching pages
 * themselves under a note that AI answers are unavailable. It reads and
 * changes nothing of the account. Each answer is announced through a polite
 * live region; links in answers open only pages on this site.
 */
export default function SupportChat({ audience, className }: Props) {
  const id = useId();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<SupportLimit | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const nextId = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const latestQuestion = useRef<HTMLLIElement>(null);
  const limitNotice = useRef<HTMLDivElement>(null);
  const busy = pending !== null;

  // While support answers, the bottom shows the question and the waiting line; once it has,
  // the latest question goes to the top, so a long answer reads from its start.
  useEffect(() => {
    const box = log.current;
    if (!box) return;
    const question = latestQuestion.current;
    box.scrollTop = pending === null && question && typeof question.offsetTop === 'number' ? question.offsetTop : box.scrollHeight;
  }, [turns.length, pending]);

  // The box is disabled once the day's messages are used: the notice that says why takes its focus.
  useEffect(() => {
    if (limit) limitNotice.current?.focus();
  }, [limit]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy || limit) return;
    const history = supportHistory(turns.map((turn): SupportTurn => (
      turn.role === 'user' ? { role: 'user', content: turn.content } : { role: 'assistant', content: historyContent(turn.answer) }
    )));
    setPending(question);
    setDraft('');
    setError(null);
    setAnnouncement(WAITING);
    try {
      const answer = await askSupport(question, history);
      setTurns((current) => [
        ...current,
        { id: nextId.current++, role: 'user', content: question },
        { id: nextId.current++, role: 'assistant', answer },
      ]);
      setAnnouncement(spoken(answer));
      setRemaining(answer.usage?.remaining ?? null);
      if (answer.usage && answer.usage.remaining <= 0) {
        setLimit({ code: 'support_chat_limit', message: '', limit: answer.usage.limit, resets_at: answer.usage.resets_at });
      }
    } catch (err) {
      // The question goes back in the box to send again, unless something new was typed meanwhile.
      setDraft((current) => (current.trim() ? current : question));
      const reached = supportLimit(err);
      if (reached) {
        setLimit(reached);
        setAnnouncement(limitSentence(reached));
      } else {
        setError(err instanceof ApiError ? err.message : 'Support could not be reached. Please try again.');
        setAnnouncement('');
      }
    } finally {
      setPending(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
    // Send is disabled while support answers; keep the focus in the box.
    input.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Never send while an IME is composing; Safari reports the committing Enter as keyCode 229.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  }

  function ask(question: string) {
    void send(question);
    input.current?.focus();
  }

  function startOver() {
    setTurns([]);
    setError(null);
    setAnnouncement('');
    input.current?.focus();
  }

  const left = SUPPORT_MESSAGE_LIMIT - draft.length;
  const suggestions = SUGGESTED_QUESTIONS[audience ?? 'member'];
  const lastQuestion = turns.findLast((turn) => turn.role === 'user')?.id;

  return (
    <Card className={mergeClasses('min-w-0 overflow-hidden', className)}>
      <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="font-heading text-lg font-semibold text-text-dark">Support chat</h2>
            <p className="mt-1 text-sm text-text-body">
              Ask how something on TenantVoice works. Answers come from the help pages; the chat can&apos;t see your account or change anything.
            </p>
          </div>
          {turns.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={startOver} disabled={busy}>Start over</Button>
          ) : null}
        </div>

        <div ref={log} className="relative max-h-[32rem] min-w-0 overflow-y-auto px-5 py-4">
          {turns.length === 0 && !busy ? (
            <div>
              <p className="text-sm text-text-body">For example:</p>
              <div role="group" aria-label="Example questions" className="mt-2 flex flex-wrap gap-2">
                {suggestions.map((question) => (
                  <Button key={question} type="button" size="sm" variant="secondary" className="h-auto min-h-11 whitespace-normal rounded-full text-left" disabled={!!limit} onClick={() => ask(question)}>
                    {question}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <ol aria-label="Support conversation" aria-busy={busy} className="space-y-4">
            {turns.map((turn) => (
              <li key={turn.id} ref={turn.id === lastQuestion ? latestQuestion : undefined} className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                {turn.role === 'user' ? <Question text={turn.content} /> : <Answer answer={turn.answer} />}
              </li>
            ))}
            {pending !== null ? (
              <li className="space-y-2">
                <div className="flex justify-end"><Question text={pending} /></div>
                <p className="text-sm text-text-body">{WAITING}</p>
              </li>
            ) : null}
          </ol>
        </div>

        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>

        {error ? (
          <div role="alert" className="mx-5 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger bg-white p-3 text-sm text-danger">
            <span className="min-w-0 break-words">{error}</span>
            <Button type="button" size="sm" variant="secondary" disabled={busy || !draft.trim()} onClick={() => ask(draft)}>Try again</Button>
          </div>
        ) : null}

        {limit ? (
          <div ref={limitNotice} tabIndex={-1} className="mx-5 mb-3 rounded-lg border border-warning bg-white p-3 text-sm focus:outline-2 focus:outline-primary-strong">
            <p className="font-semibold text-text-dark">Daily limit reached</p>
            <p className="mt-1 text-text-body">{limitSentence(limit)}</p>
            <p className="mt-1 text-text-body">
              Meanwhile, the <WithinPageLink href="/faqs" className={LINK_CLASS}>FAQs</WithinPageLink> and{' '}
              <WithinPageLink href="/contact" className={LINK_CLASS}>Contact support</WithinPageLink> can help.
            </p>
          </div>
        ) : null}

        <form onSubmit={submit} className="border-t border-border p-4">
          <label htmlFor={`${id}-question`} className="text-sm font-semibold text-text-dark">Your question</label>
          <textarea
            ref={input}
            id={`${id}-question`}
            rows={3}
            maxLength={SUPPORT_MESSAGE_LIMIT}
            value={draft}
            disabled={!!limit}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="How do I…"
            aria-describedby={`${id}-hint`}
            className="mt-2 block min-h-20 w-full min-w-0 resize-y rounded-lg border border-control-border bg-white px-3 py-2 text-base text-text-dark focus:outline-2 focus:outline-primary-strong disabled:cursor-not-allowed disabled:bg-surface sm:text-sm"
          />
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <p id={`${id}-hint`} className="min-w-0 flex-1 basis-60 text-xs leading-5 text-text-body">
              Avoid personal details such as names, phone numbers or street addresses.
              {left <= 100 ? ` ${left} characters left.` : ''}
              {!limit && remaining !== null && remaining > 0 && remaining <= 5 ? ` ${remaining} ${remaining === 1 ? 'message' : 'messages'} left today.` : ''}
            </p>
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="text-xs tabular-nums text-text-body">{draft.length}/{SUPPORT_MESSAGE_LIMIT}</span>
              <Button type="submit" disabled={busy || !draft.trim() || !!limit}>{busy ? 'Asking…' : 'Send'}</Button>
            </div>
          </div>
        </form>
      </section>
    </Card>
  );
}

function limitSentence(limit: SupportLimit): string {
  const time = resetTime(limit.resets_at);
  const again = time ? `You can ask again from ${time}, Sydney time.` : 'You can ask again after the daily reset.';
  return `You have used today's ${limit.limit} support chat messages. ${again}`;
}

/** What the live region says when an answer arrives. */
function spoken(answer: SupportAnswer): string {
  const pages = answer.sources.map((source) => source.title).join('; ');
  if (answer.source === 'ai') return `Support answered: ${plainAnswer(answer.answer)}${pages ? ` From: ${pages}.` : ''}`;
  return `${plainAnswer(answer.answer)}${pages ? ` ${pages}.` : ''}`;
}

function Question({ text }: { text: string }) {
  return (
    <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-primary-strong px-4 py-2.5 text-sm leading-6 text-white">
      <span className="sr-only">You asked: </span>
      {text}
    </p>
  );
}

function AnswerText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text-dark">
      {answerParts(text).map((part, index) => (part.kind === 'link' ? (
        <WithinPageLink key={index} href={part.href} className={LINK_CLASS}>{part.text}</WithinPageLink>
      ) : (
        <Fragment key={index}>{part.text}</Fragment>
      )))}
    </p>
  );
}

// A refusal about verification that has no documents page, as for a staff account, would tell the member to
// upload documents they cannot: the note above it says enough.
const VERIFICATION_STATUSES = ['pending', 'rejected', 'unknown'];

function Answer({ answer }: { answer: SupportAnswer }) {
  const unavailable = aiUnavailable(answer);
  const refusal = answerRefusal(answer);
  const said = refusal && (refusal.documents_href || !VERIFICATION_STATUSES.includes(refusal.status)) ? refusal.message : null;
  return (
    <div className="min-w-0 max-w-full rounded-2xl bg-surface px-4 py-3 sm:max-w-[90%]">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary-strong">
        <span className="sr-only">Support answered. </span>
        {answer.source === 'ai' ? 'AI answer from the help pages' : 'From the help pages'}
      </p>
      {unavailable ? (
        <div className="mt-2 rounded-xl border border-warning bg-white p-3">
          <AnswerText text={answer.answer} />
          {refusal ? (
            <>
              {said ? <p className="mt-1 text-sm text-text-body">{said}</p> : null}
              {refusal.documents_href ? (
                <WithinPageLink href={refusal.documents_href} className={mergeClasses('mt-1 inline-flex min-h-11 items-center text-sm', LINK_CLASS)}>
                  Go to your documents
                </WithinPageLink>
              ) : null}
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-1"><AnswerText text={answer.answer} /></div>
      )}
      <Sources sources={answer.sources} detailed={answer.source === 'help'} />
    </div>
  );
}

/** The help pages an answer comes from: links, with their text when they are the answer. */
function Sources({ sources, detailed }: { sources: SupportSource[]; detailed: boolean }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-body">{detailed ? 'Matching help pages' : 'Sources'}</p>
      <ul className="mt-2 space-y-2">
        {sources.map((source, index) => {
          const href = safeInternalHref(source.href);
          return (
            // A title is an FAQ's question too, which may hold a long link: it wraps rather than widen the log.
            <li key={index} className={mergeClasses('min-w-0', detailed ? 'rounded-xl border border-border bg-white p-3' : 'text-sm')}>
              {href ? (
                <WithinPageLink href={href} className={mergeClasses('text-sm [overflow-wrap:anywhere]', LINK_CLASS)}>{source.title}</WithinPageLink>
              ) : (
                <span className="text-sm font-semibold text-text-dark [overflow-wrap:anywhere]">{source.title}</span>
              )}
              {detailed && source.excerpt ? <p className="mt-1 break-words text-sm leading-6 text-text-body">{source.excerpt}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
