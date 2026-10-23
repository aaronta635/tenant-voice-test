// The support chat (backend POST /support/chat, tracker R37): a signed-in
// member's question about using TenantVoice, answered from its help pages.
// The server bounds the question and the conversation, counts each message
// against a daily limit, and asks the model only when the account may use AI
// (services/support_chat.py); without it, the matching help pages are the
// answer. Nothing here changes any record.

import { ApiError, apiFetch } from './api';
import { refusalOf, type VerificationRequiredDetail } from './verification-gate';

/** Matches the API: a question of at most 1,000 characters, turns of at most 2,000, the newest 10 kept. */
export const SUPPORT_MESSAGE_LIMIT = 1000;
export const SUPPORT_TURN_LIMIT = 2000;
export const SUPPORT_HISTORY_TURNS = 10;

/** Whose help the panel offers, for its example questions; the server reads the role from the account. */
export type SupportAudience = 'tenant' | 'landlord' | 'service_provider' | 'admin';

export type SupportTurn = { role: 'user' | 'assistant'; content: string };

/** A help passage an answer comes from: its title, the page it is about and its text, shortened. */
export type SupportSource = { title: string; href: string; excerpt: string };

/**
 * applied: the model answered from the sources. not_configured, unavailable,
 * verification_required: why it did not, so the sources are the answer.
 * no_match: no help page fits the question.
 */
export type SupportAiStatus = 'applied' | 'not_configured' | 'unavailable' | 'verification_required' | 'no_match';

export type SupportUsage = { used: number; limit: number; remaining: number; resets_at: string };

export type SupportAnswer = {
  /** Plain text; [label](/path) marks a link (answerParts). */
  answer: string;
  sources: SupportSource[];
  source: 'ai' | 'help';
  ai_status: SupportAiStatus;
  verification: VerificationRequiredDetail | null;
  usage: SupportUsage | null;
};

/** The 429 detail once the day's messages are used. */
export type SupportLimit = { code: 'support_chat_limit'; message: string; limit: number; resets_at: string };

export function askSupport(message: string, history: SupportTurn[]): Promise<SupportAnswer> {
  return apiFetch<SupportAnswer>('/support/chat', { method: 'POST', body: { message, history } });
}

/** The conversation the request carries: the newest turns, each within the API's bound. */
export function supportHistory(turns: SupportTurn[]): SupportTurn[] {
  return turns
    .map((turn) => ({ role: turn.role, content: turn.content.trim().slice(0, SUPPORT_TURN_LIMIT) }))
    .filter((turn) => turn.content)
    .slice(-SUPPORT_HISTORY_TURNS);
}

/** A path on this site: one slash, then path characters and an optional #section. Anything else is no link. */
const SITE_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/]*(?:#[A-Za-z0-9\-_]+)?$/;

export function safeInternalHref(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 300 && SITE_PATH.test(value) ? value : null;
}

export type AnswerPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const LINK = /\[([^[\]\n]{1,120})\]\(([^()\s]{1,300})\)/g;

/** An answer as text and links. A link to anything but a path on this site keeps only its words. */
export function answerParts(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const add = (part: AnswerPart) => {
    const last = parts.at(-1);
    if (part.kind === 'text' && last?.kind === 'text') last.text += part.text;
    else if (part.text) parts.push(part);
  };
  let start = 0;
  for (const match of text.matchAll(LINK)) {
    add({ kind: 'text', text: text.slice(start, match.index) });
    const href = safeInternalHref(match[2]);
    add(href ? { kind: 'link', text: match[1], href } : { kind: 'text', text: match[1] });
    start = match.index + match[0].length;
  }
  add({ kind: 'text', text: text.slice(start) });
  return parts;
}

/** The answer as a reader hears it: links as their words. */
export function plainAnswer(text: string): string {
  return answerParts(text).map((part) => part.text).join('');
}

/** What an answer adds to the conversation the next question carries: its words, and the pages it showed. */
export function historyContent(answer: SupportAnswer): string {
  const pages = answer.source === 'help' && answer.sources.length
    ? ` Help pages: ${answer.sources.map((source) => source.title).join('; ')}.`
    : '';
  return `${plainAnswer(answer.answer)}${pages}`.slice(0, SUPPORT_TURN_LIMIT);
}

/** Whether AI answers were unavailable, so the help pages themselves answer. */
export function aiUnavailable(answer: SupportAnswer): boolean {
  return answer.ai_status === 'not_configured' || answer.ai_status === 'unavailable' || answer.ai_status === 'verification_required';
}

/** The gate's refusal an answer carries, with a safe documents link; null for none. */
export function answerRefusal(answer: SupportAnswer): VerificationRequiredDetail | null {
  return refusalOf(answer.verification);
}

/** The daily limit's refusal an error carries; null for any other error. */
export function supportLimit(error: unknown): SupportLimit | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const detail = error.detail as Partial<SupportLimit> | null | undefined;
  if (!detail || typeof detail !== 'object' || detail.code !== 'support_chat_limit') return null;
  if (typeof detail.message !== 'string' || typeof detail.limit !== 'number' || typeof detail.resets_at !== 'string') return null;
  return { code: 'support_chat_limit', message: detail.message, limit: detail.limit, resets_at: detail.resets_at };
}

const SYDNEY_TIME = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Sydney', weekday: 'long', hour: 'numeric', minute: '2-digit',
});

/** When the count starts again, as Sydney reads it, such as "Friday 11:00 am"; null for a time it cannot read. */
export function resetTime(iso: string): string | null {
  const moment = new Date(iso);
  return Number.isNaN(moment.getTime()) ? null : SYDNEY_TIME.format(moment).replace(/\s+/g, ' ');
}

/** Example questions for each audience; any member may ask anything else. */
export const SUGGESTED_QUESTIONS: Record<SupportAudience | 'member', string[]> = {
  tenant: ['How do I get verified?', 'How do I apply for a property?', 'How do I lodge a complaint?'],
  landlord: ['How do I list a property?', 'Which documents verify my account?', 'How do I review applications?'],
  service_provider: ['How do I go live?', 'How do I accept a booking?', 'Which credentials do I need?'],
  admin: ['How do I review verification documents?', 'How do I decide a complaint?', 'How do I suspend an account?'],
  member: ['How do I get verified?', 'How do I reset my password?', 'What does a Demo label mean?'],
};
