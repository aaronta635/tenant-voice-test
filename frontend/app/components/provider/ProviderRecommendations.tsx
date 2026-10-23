'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Button from '@/app/components/ui/Button';
import EmptyState from '@/app/components/ui/EmptyState';
import FormMessage from '@/app/components/ui/FormMessage';
import PageHeader from '@/app/components/ui/PageHeader';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import RecommendationChat from '@/app/components/provider/RecommendationChat';
import RecommendationCriteriaCard from '@/app/components/provider/RecommendationCriteriaCard';
import RecommendationResults from '@/app/components/provider/RecommendationResults';
import VerificationRequired from '@/app/components/trust/VerificationRequired';
import {
  api,
  ApiError,
  orNotFound,
  type ProviderRecommendation,
  type ProviderRecommendationsResponse,
  type RecommendationChatMessage,
  type RecommendationChatResponse,
  type RecommendationCriteria,
  type ServiceProvider,
} from '@/app/lib/api';
import {
  ASSISTANT_GREETING,
  CHAT_MESSAGE_LIMIT,
  chatHistory,
  criteriaReady,
  criteriaToFilters,
  describeSearch,
  EMPTY_CRITERIA,
  keepKnownServices,
  type ChatService,
} from '@/app/lib/recommendation-chat';
import { refusalOf } from '@/app/lib/verification-gate';

const GREETING: RecommendationChatMessage = { role: 'assistant', content: ASSISTANT_GREETING };
const DEFAULT_INTRO = 'Based on your profile and service areas. Describe who you want to reach to the assistant for a focused search.';
const PROFILE_NOTE = 'These suggestions reflect profile information, not confirmed requests for your services. Connect first to learn about someone’s needs.';

type LoadError = { message: string; retry?: () => void };

/** nav, under the header, switches to the page's other recommendations (RecommendationViews). */
export default function ProviderRecommendations({ nav }: { nav?: ReactNode } = {}) {
  const router = useRouter();
  const [messages, setMessages] = useState<RecommendationChatMessage[]>([GREETING]);
  const [criteria, setCriteria] = useState<RecommendationCriteria>(EMPTY_CRITERIA);
  const [services, setServices] = useState<ChatService[]>([]);
  const [chatTurn, setChatTurn] = useState<RecommendationChatResponse | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  // null until /me/provider answers, and while that check is failing.
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ProviderRecommendationsResponse | null>(null);
  const [searchedFor, setSearchedFor] = useState<RecommendationCriteria | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [resultsVersion, setResultsVersion] = useState(0);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The card last acted on shows the outcome; requests sent from here show as pending in place.
  const [actionId, setActionId] = useState<string | null>(null);
  const [requestedIds, setRequestedIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const latestChat = useRef(0);
  const latestSearch = useRef(0);
  const criteriaHeading = useRef<HTMLHeadingElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const focusBeforeSearch = useRef<Element | null>(null);

  // Profile-based suggestions until the provider runs a search of their own.
  useEffect(() => {
    const requestId = ++latestSearch.current;
    // Without a provider profile (before onboarding step 1) these requests all answer 404,
    // so the page points to setup instead of sending them.
    const provider = orNotFound<ServiceProvider | null>(api.providers.mine(), null);
    provider
      .then((mine) => {
        if (requestId !== latestSearch.current) return null;
        setHasProvider(!!mine);
        return mine && api.recommendations.provider({ limit: 12 });
      })
      .then((data) => {
        if (data && requestId === latestSearch.current) setResult(data);
      })
      .catch((err: unknown) => {
        if (requestId === latestSearch.current) {
          setLoadError({
            message: err instanceof ApiError ? err.message : 'Could not load recommendations. Please try again.',
          });
        }
      })
      .finally(() => {
        if (requestId === latestSearch.current) setLoading(false);
      });
    // The service list appears in the search details before the first chat turn.
    provider
      .then((mine) => mine ? api.providers.myServices() : [])
      .then((rows) => setServices((current) => current.length ? current : rows
        .filter((service) => service.is_active)
        // Same order and cap as the chat and search endpoints use.
        .sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, 20)
        .map((service) => ({ id: service.id, title: service.title }))))
      .catch(() => { /* the first chat reply also lists the services */ });
    return () => { latestSearch.current += 1; };
  }, [attempt]);

  // Move focus to the new results after their heading has rendered, but only if
  // the provider has not moved on (typing, editing the card) while waiting.
  useEffect(() => {
    if (resultsVersion === 0) return;
    const active = document.activeElement;
    if (!active || active === document.body || active === focusBeforeSearch.current) resultsHeading.current?.focus();
  }, [resultsVersion]);

  async function runChat(history: RecommendationChatMessage[], current: RecommendationCriteria) {
    const requestId = ++latestChat.current;
    setChatBusy(true);
    setChatError(null);
    try {
      const response = await api.recommendations.chat({ messages: chatHistory(history), criteria: current });
      if (requestId !== latestChat.current) return;
      setChatTurn(response);
      setServices(response.services);
      setCriteria(keepKnownServices(response.criteria, response.services));
      setMessages((existing) => [...existing, { role: 'assistant', content: response.reply }]);
    } catch (err) {
      if (requestId !== latestChat.current) return;
      setChatError(err instanceof ApiError ? err.message : 'Could not reach the assistant. Please try again.');
    } finally {
      if (requestId === latestChat.current) setChatBusy(false);
    }
  }

  function sendMessage(text: string) {
    if (chatBusy) return;
    const next: RecommendationChatMessage[] = [...messages, { role: 'user', content: text.slice(0, CHAT_MESSAGE_LIMIT) }];
    setMessages(next);
    setChatTurn((turn) => turn && { ...turn, quick_replies: [] });
    void runChat(next, criteria);
  }

  function resetChat() {
    latestChat.current += 1;
    if (searching) {
      // An abandoned search must neither replace the results nor take focus later.
      latestSearch.current += 1;
      setSearching(false);
      setLoading(false);
    }
    setMessages([GREETING]);
    setCriteria(EMPTY_CRITERIA);
    setChatTurn(null);
    setChatError(null);
    setChatBusy(false);
  }

  async function search(target: RecommendationCriteria) {
    if (!criteriaReady(target)) return;
    const requestId = ++latestSearch.current;
    focusBeforeSearch.current = document.activeElement;
    setLoading(true);
    setSearching(true);
    setLoadError(null);
    setActionError(null);
    setActionNotice(null);
    try {
      // The server reranks with AI only when it is configured; otherwise it returns profile matches.
      const data = await api.recommendations.analyzeProvider(criteriaToFilters(target));
      if (requestId !== latestSearch.current) return;
      setResult(data);
      setSearchedFor(target);
      setResultsVersion((version) => version + 1);
    } catch (err) {
      if (requestId !== latestSearch.current) return;
      setLoadError({
        message: err instanceof ApiError ? err.message : 'Could not find matches. Please try again.',
        retry: () => void search(target),
      });
    } finally {
      if (requestId === latestSearch.current) {
        setLoading(false);
        setSearching(false);
      }
    }
  }

  function findMatches() {
    if (!searching) void search(criteria);
  }

  function editDetails() {
    criteriaHeading.current?.focus();
  }

  async function connect(person: ProviderRecommendation) {
    if (busyId) return;
    setActionId(person.id);
    setActionNotice('Sending connection request…');
    setBusyId(person.id);
    setActionError(null);
    try {
      await api.connections.request(person.id);
      window.dispatchEvent(new Event('tenantvoice:counts-changed'));
      setActionNotice('Connection request sent.');
      // Not regrouped until the next search: moving the card would take its message away.
      setRequestedIds((ids) => [...ids, person.id]);
    } catch (err) {
      setActionNotice(null);
      setActionError(err instanceof ApiError ? err.message : 'Could not send the connection request. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function messagePerson(person: ProviderRecommendation) {
    if (busyId) return;
    setActionId(person.id);
    setActionNotice('Opening conversation…');
    setBusyId(person.id);
    setActionError(null);
    try {
      const thread = await api.conversations.startRental({ peer_id: person.id, subject: `Chat with ${person.full_name}` });
      router.push(`/dashboard/messages?thread=${thread.id}`);
    } catch (err) {
      setActionNotice(null);
      setActionError(err instanceof ApiError ? err.message : 'Could not open the conversation. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  function retryLoad() {
    if (loadError?.retry) loadError.retry();
    else {
      // The first load failed: run it again, profile check included.
      setLoading(true);
      setLoadError(null);
      setAttempt((value) => value + 1);
    }
  }

  const awaitingReply = messages[messages.length - 1]?.role === 'user';
  const canConfirm = chatTurn?.state === 'confirm' && !awaitingReply && criteriaReady(criteria);
  const searchLabel = searchedFor ? describeSearch(searchedFor, services) : '';
  const aiConfigured = chatTurn ? chatTurn.ai_status !== 'not_configured' : !!result && result.ai_status !== 'not_configured';
  // "AI not connected" is already shown by the assistant; repeat only notes about this search.
  const aiNote = result && ['applied', 'unavailable', 'cooldown'].includes(result.ai_status) ? result.message : null;
  // The model is paid AI, which needs a verified account (tracker R18): refused, the guided
  // questions and profile matches answer, and the page says why, once.
  const aiRefusal = refusalOf(chatTurn?.verification) ?? refusalOf(result?.verification);
  // Connect and Message report inside their card; up here only once that card has left the list.
  const actionListed = !!result?.items.some((item) => item.id === actionId);

  const header = (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <PageHeader title="Recommendations" description="Tell the assistant who you want to reach. It asks for anything missing, then you confirm the search." />
      <Link href="/dashboard/network" className="rounded-lg px-3 py-2 text-sm font-semibold text-primary-strong hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary">
        View my network &rarr;
      </Link>
    </header>
  );

  if (!hasProvider) {
    return (
      <div className="space-y-6">
        {header}
        {nav}
        {hasProvider === false ? (
          <EmptyState title="Create your provider profile" description="Finish the first onboarding step to get recommendations and use the assistant." action={<Link href="/dashboard/onboarding" className="font-bold text-primary-strong underline">Start onboarding</Link>} />
        ) : loadError ? (
          <LoadErrorCard title="Recommendations could not be loaded" message={loadError.message} onRetry={retryLoad} />
        ) : (
          <p role="status" className="text-sm text-text-body">Loading recommendations…</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {nav}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <RecommendationChat
          messages={messages}
          quickReplies={chatTurn?.quick_replies ?? []}
          canConfirm={canConfirm}
          summary={canConfirm ? describeSearch(criteria, services) : null}
          aiConfigured={aiConfigured}
          busy={chatBusy}
          searching={searching}
          error={chatError}
          aiStatus={chatTurn?.ai_status ?? null}
          onSend={sendMessage}
          onRetry={() => void runChat(messages, criteria)}
          onConfirm={findMatches}
          onReset={resetChat}
          onEditDetails={editDetails}
        />
        <RecommendationCriteriaCard
          ref={criteriaHeading}
          criteria={criteria}
          services={services}
          disabled={chatBusy}
          searching={searching}
          onChange={setCriteria}
          onSearch={findMatches}
        />
      </div>

      {aiRefusal ? <VerificationRequired detail={aiRefusal} /> : null}

      {loadError && !result ? (
        <LoadErrorCard title="Recommendations could not be loaded" message={loadError.message} onRetry={retryLoad} />
      ) : loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-white p-4 text-sm text-text-body">
          <p>{loadError.message} Your previous results remain below.</p>
          <Button type="button" variant="secondary" disabled={loading || !!busyId} onClick={retryLoad}>Try again</Button>
        </div>
      ) : null}

      <FormMessage error={actionListed ? null : actionError} success={actionListed ? null : actionNotice} />

      <RecommendationResults
        ref={resultsHeading}
        heading={searchedFor ? `Matches for ${searchLabel}` : 'Suggested for you'}
        intro={searchedFor ? [aiNote, PROFILE_NOTE].filter(Boolean).join(' ') : `${DEFAULT_INTRO} ${PROFILE_NOTE}`}
        result={result}
        loading={loading}
        busyId={busyId}
        actionId={actionId}
        actionError={actionError}
        actionNotice={actionNotice}
        requestedIds={requestedIds}
        emptyAction={<Button type="button" variant="secondary" onClick={editDetails}>Change search details</Button>}
        onConnect={(person) => void connect(person)}
        onMessage={(person) => void messagePerson(person)}
      />
    </div>
  );
}
