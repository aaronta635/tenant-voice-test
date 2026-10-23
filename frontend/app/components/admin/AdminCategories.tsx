'use client';

import { useEffect, useRef, useState } from 'react';
import CategoryFormDialog from '@/app/components/admin/CategoryFormDialog';
import ComplaintsSectionNav from '@/app/components/admin/ComplaintsSectionNav';
import ReasonDialog from '@/app/components/admin/ReasonDialog';
import StatePill from '@/app/components/admin/StatePill';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import {
  adminComplaintsApi,
  POLICY_SEVERITY_LABELS,
  type CodeChoice,
  type IssueCategory,
  type IssueCategoryList,
} from '@/app/lib/admin-complaints-api';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';

type Loaded = { attempt: number; list: IssueCategoryList | null; error: string | null };
type Editing = { category: IssueCategory | null } | null;

/**
 * The alert policies both apps share (GET /admin/complaint-categories): each
 * covers complaint categories and words in a complaint's description, and an
 * unresolved complaint it covers raises an admin alert once it passes the
 * policy's response time. Admins add, edit, deactivate and activate them;
 * complaints keep their own fixed categories whatever happens here.
 */
export default function AdminCategories() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [deactivating, setDeactivating] = useState<IssueCategory | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const current = loaded?.attempt === attempt ? loaded : null;
  // A reload keeps the list on screen, so an open dialog keeps its place.
  const list = current?.list ?? loaded?.list ?? null;

  useEffect(() => {
    let active = true;
    adminComplaintsApi.categories().then(
      (found) => { if (active) setLoaded({ attempt, list: found, error: null }); },
      (error) => { if (active) setLoaded({ attempt, list: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => { if (message) focusResult(messageRef.current, pageRef.current); }, [message]);

  function replaced(category: IssueCategory, text: string) {
    setLoaded((previous) => {
      if (!previous?.list) return previous;
      const known = previous.list.categories.find((item) => item.id === category.id);
      const merged = { ...category, complaint_count: category.complaint_count ?? known?.complaint_count ?? 0 };
      const categories = known
        ? previous.list.categories.map((item) => (item.id === category.id ? merged : item))
        : [...previous.list.categories, merged];
      return { ...previous, list: { ...previous.list, categories } };
    });
    setMessage({ text, error: false });
    // The counts come from the server: read them again behind the list.
    setAttempt((value) => value + 1);
  }

  async function activate(category: IssueCategory) {
    try {
      replaced(await adminComplaintsApi.setCategoryActive(category.id, true), `${category.name} raises alerts again.`);
    } catch (error) {
      setMessage({ text: error instanceof ApiError ? error.message : `${category.name} was not activated. Please try again.`, error: true });
    }
  }

  return (
    <div ref={pageRef} className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Alert policies"
        description="When a complaint raises an admin alert. Each policy covers complaint categories and words in a complaint's description, with a severity and a response time. The web and mobile apps share them; complaints keep their own categories."
        actions={list ? <Button onClick={() => setEditing({ category: null })}>New policy</Button> : undefined}
      />
      <ComplaintsSectionNav current="categories" />

      <div ref={messageRef} tabIndex={-1}>
        <FormMessage error={message?.error ? message.text : null} success={message && !message.error ? message.text : null} />
      </div>

      {!list && !current ? (
        <div role="status" aria-label="Loading the policies" className="space-y-3">
          {[0, 1, 2].map((index) => <div key={index} aria-hidden className="h-24 animate-pulse rounded-2xl border border-border bg-white" />)}
        </div>
      ) : !list ? (
        <LoadErrorCard title="Couldn't load the policies" message={current?.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
      ) : (
        <section aria-labelledby="policies-heading" className="min-w-0">
          <h2 id="policies-heading" className="font-heading text-h4 font-semibold text-text-dark">
            {list.categories.length} {list.categories.length === 1 ? 'policy' : 'policies'}
          </h2>
          {list.categories.length === 0 ? (
            <Card className="mt-3 p-6">
              <p className="text-sm text-text-body">No policies yet, so no complaint raises an alert. Add one to start.</p>
            </Card>
          ) : (
            <ul className="mt-3 space-y-3">
              {list.categories.map((category) => (
                <li key={category.id}>
                  <PolicyCard
                    category={category}
                    codes={list.codes}
                    onEdit={() => setEditing({ category })}
                    onDeactivate={() => setDeactivating(category)}
                    onActivate={() => activate(category)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <CategoryFormDialog
        key={editing ? editing.category?.id ?? 'new' : 'closed'}
        category={editing?.category ?? null}
        codes={list?.codes ?? []}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(category) => {
          const isNew = editing?.category === null;
          setEditing(null);
          replaced(category, isNew ? `${category.name} was added and raises alerts.` : `${category.name} was saved.`);
        }}
        onStale={() => setAttempt((value) => value + 1)}
        returnFocus={() => messageRef.current}
      />

      <ReasonDialog
        key={deactivating?.id ?? 'none'}
        open={deactivating !== null}
        title={deactivating ? `Deactivate ${deactivating.name}` : 'Deactivate the policy'}
        effect={(
          <p>
            It stops raising alerts, in the web and mobile apps. The complaints it covers keep their categories,
            and you can activate it again.
          </p>
        )}
        confirmLabel="Deactivate"
        reasonHelp="Kept in the audit log with your name and the time."
        onClose={() => setDeactivating(null)}
        onConfirm={async (reason) => {
          if (!deactivating) return null;
          try {
            const category = await adminComplaintsApi.setCategoryActive(deactivating.id, false, reason);
            setDeactivating(null);
            replaced(category, `${category.name} no longer raises alerts.`);
            return null;
          } catch (error) {
            return error instanceof ApiError ? error.message : 'The policy was not deactivated. Please try again.';
          }
        }}
        returnFocus={() => messageRef.current}
      />
    </div>
  );
}

function PolicyCard({ category, codes, onEdit, onDeactivate, onActivate }: {
  category: IssueCategory; codes: CodeChoice[]; onEdit: () => void; onDeactivate: () => void; onActivate: () => void;
}) {
  const labels = new Map(codes.map((choice) => [choice.code, choice.label]));
  // Another app's value, not a code of the list, is shown as stored.
  const covered = category.source_categories.map((value) => labels.get(value.toUpperCase()) ?? value);
  const count = category.complaint_count ?? 0;
  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="break-words font-heading text-base font-semibold text-text-dark">{category.name}</span>
          <StatePill tone={category.is_active ? 'success' : 'neutral'}>{category.is_active ? 'Active' : 'Inactive'}</StatePill>
          <span className="min-w-0 break-all font-mono text-xs text-text-body">{category.code}</span>
        </p>
        {category.description ? <p className="mt-1 break-words text-sm text-text-body">{category.description}</p> : null}
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-body">
          {category.severity ? <span>{POLICY_SEVERITY_LABELS[category.severity] ?? category.severity} severity</span> : null}
          {category.sla_hours ? <span>Respond within {category.sla_hours} {category.sla_hours === 1 ? 'hour' : 'hours'}</span> : null}
          {category.routing_team ? <span className="break-words">{category.routing_team}</span> : null}
          <span>Covers {count} {count === 1 ? 'complaint' : 'complaints'}</span>
        </p>
        <p className="mt-1 break-words text-xs text-text-body">
          {covered.length ? `Categories: ${covered.join(', ')}` : 'No categories: keywords only'}
        </p>
        {category.keywords.length ? <p className="mt-1 break-words text-xs text-text-body">Keywords: {category.keywords.join(', ')}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onEdit}>Edit<span className="sr-only"> {category.name}</span></Button>
        {category.is_active ? (
          <Button variant="ghost" size="sm" onClick={onDeactivate}>Deactivate<span className="sr-only"> {category.name}</span></Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onActivate}>Activate<span className="sr-only"> {category.name}</span></Button>
        )}
      </div>
    </Card>
  );
}
