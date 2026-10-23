'use client';

import { useEffect, useId, useRef, useState } from 'react';
import DocumentCard from '@/app/components/documents/DocumentCard';
import LegacyPicksNotice from '@/app/components/documents/LegacyPicksNotice';
import RequirementsSummary from '@/app/components/documents/RequirementsSummary';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import type { LegacyPickRole } from '@/app/lib/legacy-document-picks';
import {
  documentsApi,
  documentsOfType,
  groupedTypes,
  type DocumentChecklist,
  type ProfileDocument,
} from '@/app/lib/profile-documents';

type Props = {
  /** The role whose old, local-only file picks this panel clears (lib/legacy-document-picks). */
  legacyPicks?: LegacyPickRole;
};

type Loaded = { attempt: number; checklist: DocumentChecklist | null; error: string | null };

/**
 * The signed-in person's private documents (R15): what their verification
 * needs, and a card per document type of their role, from /me/documents.
 * Everything shown is what the server saved; nothing is kept in the browser.
 */
export default function DocumentsPanel({ legacyPicks }: Props) {
  const id = useId();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const current = loaded?.attempt === attempt ? loaded : null;

  // A deleted document's card may go with it: its result shows here instead.
  useEffect(() => { if (notice) focusResult(noticeRef.current, panel.current); }, [notice]);

  useEffect(() => {
    let active = true;
    documentsApi.checklist().then(
      (checklist) => { if (active) setLoaded({ attempt, checklist, error: null }); },
      (error) => {
        if (active) setLoaded({ attempt, checklist: null, error: error instanceof ApiError ? error.message : 'Please try again.' });
      },
    );
    return () => { active = false; };
  }, [attempt]);

  function update(change: (documents: ProfileDocument[]) => ProfileDocument[]) {
    // A saved document changes what verification needs: reload the checklist
    // for the requirements, showing the saved document straight away.
    setLoaded((previous) => previous?.checklist
      ? { ...previous, checklist: { ...previous.checklist, documents: change(previous.checklist.documents) } }
      : previous);
    documentsApi.checklist().then(
      (checklist) => setLoaded((previous) => (previous?.checklist ? { ...previous, checklist } : previous)),
      () => undefined,
    );
  }

  const saved = (document: ProfileDocument) => {
    setNotice(null);
    update((documents) => (
      documents.some((item) => item.id === document.id)
        ? documents.map((item) => (item.id === document.id ? document : item))
        : [document, ...documents]
    ));
  };
  const deleted = (document: ProfileDocument) => {
    setNotice(`${document.label} deleted.`);
    update((documents) => documents.filter((item) => item.id !== document.id));
  };

  const checklist = current?.checklist;
  const typeLabel = (type: string) => checklist?.types.find((item) => item.type === type)?.label ?? type;

  return (
    <div ref={panel} className="flex min-w-0 flex-col gap-6" aria-busy={!current}>
      {legacyPicks ? <LegacyPicksNotice role={legacyPicks} /> : null}
      <p ref={noticeRef} role="status" tabIndex={-1} className={notice ? 'rounded-lg border border-success bg-white p-3 text-sm text-success' : 'sr-only'}>
        {notice ?? ''}
      </p>

      <section aria-labelledby={`${id}-privacy`} className="rounded-2xl border border-primary/30 bg-surface p-5">
        <h2 id={`${id}-privacy`} className="flex items-center gap-2 font-heading text-h4 font-semibold text-text-dark">
          <LockIcon />
          Your documents are private
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-dark">
          <li>Documents never appear on your public profile.</li>
          <li>You and TenantVoice admins can open them, through a link that works for 5 minutes.</li>
          {checklist?.can_share ? (
            <>
              <li>On the website, you choose per document whether owners of listings you apply to may see it.</li>
              <li>
                In the TenantVoice app, the owner of a listing you have an open or approved application for can open
                all of your documents.
              </li>
            </>
          ) : null}
          <li>You keep one document of each kind. Uploading another replaces it.</li>
          <li>You can replace or delete a document at any time. Replacing or deleting one your verification needs puts your account back in review.</li>
        </ul>
      </section>

      {!current ? (
        <div role="status" className="space-y-3">
          <p className="text-sm text-text-body">Loading your documents…</p>
          {[0, 1, 2].map((index) => <div key={index} aria-hidden className="h-24 animate-pulse rounded-xl border border-border bg-white" />)}
        </div>
      ) : !checklist ? (
        <LoadErrorCard title="Couldn't load your documents" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
      ) : (
        <>
          <RequirementsSummary requirements={checklist.requirements} met={checklist.requirements_met} account={checklist.account} typeLabel={typeLabel} />
          {checklist.documents.length === 0 ? (
            <p className="text-sm text-text-body">You have not uploaded any documents yet. Start with the ones verification needs.</p>
          ) : null}
          {groupedTypes(checklist.types).map((group) => (
            <section key={group.group} aria-labelledby={`${id}-${group.group}`} className="min-w-0">
              <h2 id={`${id}-${group.group}`} className="text-xs font-semibold uppercase tracking-[0.12em] text-text-body">
                {group.label}
              </h2>
              <ul className="mt-3 space-y-3">
                {group.types.flatMap((type) => {
                  const kept = documentsOfType(checklist, type.type);
                  // Each type has one card, whose result survives an upload or a
                  // delete (UNIQUE (user_id, document_type)); a repeatable type
                  // would list each document, then a slot for one more.
                  const slots = type.repeatable
                    ? [...kept.map((document) => ({ key: document.id, document })), { key: `${type.type}-new`, document: null }]
                    : kept.length
                      ? kept.map((document, index) => ({ key: index === 0 ? type.type : document.id, document }))
                      : [{ key: type.type, document: null }];
                  return slots.map(({ key, document }) => (
                    <li key={key}>
                      <DocumentCard type={type} document={document} canShare={checklist.can_share} onSaved={saved} onDeleted={deleted} />
                    </li>
                  ));
                })}
              </ul>
            </section>
          ))}
          <p className="text-xs text-text-body">PDF, JPG, PNG or WebP files, up to 5 MB each.</p>
        </>
      )}
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0 text-primary-strong" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
