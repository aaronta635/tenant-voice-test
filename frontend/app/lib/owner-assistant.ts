// The owner AI assistant (backend services/owner_assistant.py, tracker R29-R31).
// A question gets the model's answer, or the rules' answer under an "AI
// unavailable" label. An action the model proposes is a preview only: the
// owner confirms it, and the server runs exactly the saved action.

/** ready: the model answers; applied: it answered this one; the rest say why the rules answered. */
export type OwnerAiStatus = 'ready' | 'applied' | 'not_configured' | 'verification_required' | 'unavailable';

export type ActionChange = { label: string; value: string };

export type ActionPreview = {
  title: string;
  /** Every value the action writes, in words (times already in Sydney time). */
  changes: ActionChange[];
  notes: string[];
  /** What stays a demo about it (docs/demo-features.md), or null. */
  demo: string | null;
};

export type OwnerAssistantAction = { operation: string; payload: Record<string, unknown>; preview: ActionPreview };

export type ProviderSuggestion = {
  id: string;
  name: string;
  categories: string[];
  location: string | null;
  pricing: string | null;
  rating: number | null;
  hourly_rate: number | null;
  /** The facts behind the suggestion: rating, area, category and price. */
  reasons: string[];
};

export type OwnerAssistantAnswer = {
  request_id: string;
  question: string;
  reply: string;
  source: 'ai' | 'rules';
  ai_status: OwnerAiStatus;
  ai_labelled: boolean;
  cached: boolean;
  action: OwnerAssistantAction | null;
  providers: ProviderSuggestion[];
  verification: unknown;
};

export type OwnerAssistantConfirmation = {
  request_id: string;
  action_request_id: string;
  operation: string;
  message: string;
  record: Record<string, unknown> | null;
  saved: ActionChange[];
  /** The receipt id once the chat history carries it, else null. */
  receipt: string | null;
  /** The turn's reply now: the action's message and its receipt. */
  reply: string;
};

export type OwnerAssistantWorkspace = {
  context?: unknown;
  history?: unknown;
  workspace?: unknown;
  ai_status?: OwnerAiStatus;
  verification?: unknown;
  ai_labelled?: boolean;
};

/** How the backend's rules start every reply they write (RULES_LABEL). */
export const RULES_REPLY_START = 'AI unavailable:';
/** How this page's replies started before a model was connected: the saved data, not an answer. */
export const SAVED_DATA_REPLY_START = 'AI-labelled, read-only until you confirm a separate action.';

export type ReplyKind = 'ai' | 'rules' | 'saved-data' | 'unknown';

/** What wrote a reply: the model (source ai), the rules, the old saved-data echo, or unknown (history). */
export function replyKind(reply: string, source?: 'ai' | 'rules'): ReplyKind {
  if (reply.startsWith(RULES_REPLY_START)) return 'rules';
  if (reply.startsWith(SAVED_DATA_REPLY_START)) return 'saved-data';
  return source === 'ai' ? 'ai' : 'unknown';
}

export type HistoryTurn = { question: string; reply: string };

/** The saved turns, oldest first, from mobile_owner_assistant_history; anything malformed is skipped. */
export function historyTurns(history: unknown): HistoryTurn[] {
  if (!Array.isArray(history)) return [];
  return history.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const { question, reply } = row as Record<string, unknown>;
    return typeof question === 'string' && typeof reply === 'string' && question && reply ? [{ question, reply }] : [];
  });
}

/** A request id for one question: the server answers an id it has seen with the saved answer. */
export function newRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
