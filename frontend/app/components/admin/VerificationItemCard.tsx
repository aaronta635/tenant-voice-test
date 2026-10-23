'use client';

import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import RejectDialog from '@/app/components/admin/RejectDialog';
import DocumentStatusBadge from '@/app/components/documents/DocumentStatusBadge';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import { buttonClassName } from '@/app/components/ui/button-styles';
import {
  adminApi,
  ROLE_LABELS,
  type MobileVerificationDocument,
  type ReviewDocument,
  type ReviewStatus,
  type VerificationItem,
} from '@/app/lib/admin-api';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatDate } from '@/app/lib/format';
import { VERIFICATION_LABELS } from '@/app/lib/profile-documents';

type Props = {
  /** The account, just loaded: its links work for their expires_in seconds from when it arrives. */
  item: VerificationItem;
  /** The status the queue lists, which a reload asks for again. */
  status: ReviewStatus;
  /** The account as the server has it after a decision. */
  onReloaded: (item: VerificationItem) => void;
};

type Rejecting = { kind: 'document'; document: ReviewDocument } | { kind: 'account' } | null;

// A link this close to expiring is signed again when clicked.
const LINK_MARGIN_SECONDS = 20;

const DOCUMENTS_HEADING: Record<ReviewStatus, string> = {
  PENDING: 'Documents in review',
  APPROVED: 'Approved documents',
  REJECTED: 'Rejected documents',
};

const NOTHING_LEFT: Record<ReviewStatus, string> = {
  PENDING: 'Nothing left to review for this account.',
  APPROVED: 'This account has no approved documents any more.',
  REJECTED: 'This account has no rejected documents any more.',
};

/** "2 Mar 2026" for a time the mobile app saved, or null when it is not one. */
function uploadedOn(value: string | null) {
  const shown = formatDate(value);
  return shown === '—' ? null : shown;
}

/**
 * One account in the verification queue: what its role's verification needs,
 * its documents with a link to each file, and Approve and Reject for each
 * document in review and, while it is in review, for the account. The
 * documents the mobile app keeps are listed read-only, with their links. A
 * decision the server refuses because another admin, or the person, changed
 * something first (409) reloads the account and says so; nothing is
 * overwritten.
 */
export default function VerificationItemCard({ item, status, onReloaded }: Props) {
  const id = useId();
  const card = useRef<HTMLElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  // When this item, and so its signed links, arrived.
  const linksSignedAt = useRef(0);
  // The action running: "account" or a document's id.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ url: string; name: string } | null>(null);
  const [rejecting, setRejecting] = useState<Rejecting>(null);
  const name = item.full_name || item.email || 'This account';
  const account = item.account;
  const mobileDocuments = item.mobile_documents ?? [];
  // review_user_verification decides an account while it is in review only.
  const accountInReview = account.status === 'pending';
  const availability = { 'aria-disabled': busy ? true : undefined } as const;

  useEffect(() => {
    linksSignedAt.current = Date.now();
  }, [item]);

  useEffect(() => {
    if (error || success || opened) focusResult(feedback.current, card.current);
  }, [error, success, opened]);

  /**
   * Runs one decision and reloads the account. Resolves with a problem when
   * nothing was saved for a reason worth trying again; a conflict (409, or a
   * document gone: 404) is said in the card instead, over the latest version.
   */
  async function decide(key: string, save: () => Promise<string>, conflict: (error: ApiError) => string) {
    setBusy(key);
    setError(null);
    setSuccess(null);
    setOpened(null);
    try {
      setSuccess(await save());
    } catch (err) {
      if (!(err instanceof ApiError) || (err.status !== 409 && err.status !== 404)) {
        setBusy(null);
        return err instanceof ApiError ? err.message : 'The decision was not saved. Please try again.';
      }
      setError(conflict(err));
    }
    try {
      onReloaded(await adminApi.verificationItem(item.user_id, status));
    } catch {
      setError((shown) => `${shown ? `${shown} ` : ''}The latest version could not be loaded. Reload the page.`);
    }
    setBusy(null);
    return null;
  }

  const changedMeanwhile = (document: ReviewDocument) => (error: ApiError) => (
    error.status === 404
      ? `${document.label} is no longer there, so your decision was not saved. The person may have deleted it.`
      : `${document.label} changed since this page loaded, so your decision was not saved. The latest version is shown.`
  );

  function decideDocument(document: ReviewDocument, decision: 'APPROVED' | 'REJECTED', reason = '') {
    return decide(document.id, async () => {
      const result = await adminApi.decideDocument(document, decision, reason);
      if (decision === 'REJECTED') return `${document.label} rejected. ${name} is told why.`;
      const verifiedNow = result.account.status === 'verified' && account.status !== 'verified';
      return `${document.label} approved.${verifiedNow ? ` ${name}'s account is now verified.` : ''}`;
    }, changedMeanwhile(document));
  }

  function decideAccount(decision: 'APPROVED' | 'REJECTED', reason = '') {
    return decide('account', async () => {
      await adminApi.decideAccount(item.user_id, decision, reason);
      return decision === 'APPROVED' ? `${name}'s account is verified.` : `${name}'s account was rejected. They are told why.`;
    }, (error) => error.message);
  }

  async function approve(run: () => Promise<string | null>) {
    if (busy) return;
    const problem = await run();
    if (problem) setError(problem);
  }

  async function reject(reason: string) {
    if (!rejecting) return null;
    const problem = rejecting.kind === 'account'
      ? await decideAccount('REJECTED', reason)
      : await decideDocument(rejecting.document, 'REJECTED', reason);
    if (!problem) setRejecting(null);
    return problem;
  }

  /** The signed link opens the file itself while it works; past that (now, in ms), a fresh one is signed and audited. */
  function view(event: MouseEvent<HTMLElement>, document: ReviewDocument, now: number) {
    const link = document.link;
    if (link && now < linksSignedAt.current + (link.expires_in - LINK_MARGIN_SECONDS) * 1000) return;
    event.preventDefault();
    setError(null);
    setOpened(null);
    // Opened inside the click, so a popup blocker lets it through.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    adminApi.documentLink(document.id).then(
      ({ url }) => {
        if (tab && !tab.closed) tab.location.href = url;
        else setOpened({ url, name: document.file_name ?? document.label });
      },
      (err) => {
        tab?.close();
        setError(`${document.label} could not be opened. ${err instanceof ApiError ? err.message : 'Please try again.'}`);
      },
    );
  }

  /**
   * A mobile document's link while it works; past that the account is read
   * again for a fresh one, which the server signs and audits as it lists it.
   */
  function viewMobile(event: MouseEvent<HTMLElement>, document: MobileVerificationDocument, now: number) {
    const link = document.link;
    if (link && now < linksSignedAt.current + (link.expires_in - LINK_MARGIN_SECONDS) * 1000) return;
    event.preventDefault();
    setError(null);
    setOpened(null);
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    adminApi.verificationItem(item.user_id, status).then(
      (fresh) => {
        onReloaded(fresh);
        const url = fresh.mobile_documents?.find((entry) => entry.key === document.key)?.link?.url;
        if (!url) {
          tab?.close();
          setError(`${document.name} could not be opened. The mobile app no longer lists it.`);
        } else if (tab && !tab.closed) tab.location.href = url;
        else setOpened({ url, name: document.name });
      },
      (err) => {
        tab?.close();
        setError(`${document.name} could not be opened. ${err instanceof ApiError ? err.message : 'Please try again.'}`);
      },
    );
  }

  return (
    <article ref={card} aria-labelledby={`${id}-name`} className="min-w-0 rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 id={`${id}-name`} className="font-heading text-h4 font-semibold break-words">
            <Link href={`/admin/users/${encodeURIComponent(item.user_id)}`} className="text-primary-strong underline">{name}</Link>
          </h3>
          {item.email ? <p className="break-all text-sm text-text-body">{item.email}</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-body">
            <span>{ROLE_LABELS[item.role] ?? item.role}{item.primary_role === 'AGENT' ? ' (agent)' : ''}</span>
            <DocumentStatusBadge status={account.status} label={`Account ${VERIFICATION_LABELS[account.status].toLowerCase()}`} />
          </p>
          {account.status === 'rejected' && account.rejection_reason ? (
            <p className="mt-1 text-sm text-danger">
              <span className="font-semibold">{account.account_rejected ? 'Rejected by an admin: ' : 'Rejected: '}</span>
              {account.rejection_reason}
            </p>
          ) : null}
          {item.approval_note ? <p className="mt-1 text-sm text-text-body">{item.approval_note}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {item.can_approve ? (
            <Button size="sm" {...availability} onClick={() => void approve(() => decideAccount('APPROVED'))}>
              {busy === 'account' ? 'Saving…' : 'Approve account'}<span className="sr-only"> of {name}</span>
            </Button>
          ) : null}
          {accountInReview ? (
            <Button variant="secondary" size="sm" {...availability} onClick={() => { if (!busy) setRejecting({ kind: 'account' }); }}>
              Reject account<span className="sr-only"> of {name}</span>
            </Button>
          ) : null}
        </div>
      </div>

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-body">What verification needs</h4>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {item.requirements.map((requirement) => (
          <li key={requirement.key} className="flex flex-wrap items-center gap-2 text-sm text-text-dark">
            {requirement.label} <DocumentStatusBadge status={requirement.status} />
          </li>
        ))}
      </ul>

      <div ref={feedback} tabIndex={-1} className="mt-3">
        <FormMessage error={error} success={success} />
        {opened ? (
          <p className="text-sm">
            <a href={opened.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-strong underline">
              Open {opened.name}
            </a>{' '}
            <span className="text-text-body">(the link works for 5 minutes)</span>
          </p>
        ) : null}
      </div>

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-body">{DOCUMENTS_HEADING[status]}</h4>
      {item.documents.length === 0 ? (
        <p className="mt-2 text-sm text-text-body">{mobileDocuments.length ? 'None from the website.' : NOTHING_LEFT[status]}</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {item.documents.map((document) => (
            <li key={document.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-dark">{document.label}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-body">
                  <DocumentStatusBadge status={document.status} />
                  {document.file_name ? <span className="min-w-0 break-all">{document.file_name}</span> : null}
                  <span>Submitted {formatDate(document.submitted_at)}</span>
                  {document.status === 'verified' && document.verified_at ? <span>Approved {formatDate(document.verified_at)}</span> : null}
                </p>
                {document.status === 'rejected' ? (
                  <p className="mt-1 text-sm text-danger">Rejected: {document.rejection_reason ?? 'no reason was given'}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {document.link ? (
                  <a
                    href={document.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => view(event, document, Date.now())}
                    className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                  >
                    View<span className="sr-only"> {document.label} (opens in a new tab)</span>
                  </a>
                ) : document.can_open ? (
                  <Button variant="secondary" size="sm" onClick={(event) => view(event, document, Date.now())}>
                    View<span className="sr-only"> {document.label}</span>
                  </Button>
                ) : (
                  <p className="text-sm text-text-body">{document.has_file ? 'Stored outside TenantVoice' : 'No file'}</p>
                )}
                {document.status === 'pending' ? (
                  <>
                    <Button size="sm" {...availability} onClick={() => void approve(() => decideDocument(document, 'APPROVED'))}>
                      {busy === document.id ? 'Saving…' : 'Approve'}<span className="sr-only"> {document.label}</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      {...availability}
                      onClick={() => { if (!busy) setRejecting({ kind: 'document', document }); }}
                    >
                      Reject<span className="sr-only"> {document.label}</span>
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {mobileDocuments.length ? (
        <>
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-body">From the mobile app</h4>
          <p className="mt-1 text-sm text-text-body">
            Shown as the app saved them, with no review of their own: decide the account once you have checked them.
          </p>
          <ul className="mt-1 divide-y divide-border">
            {mobileDocuments.map((document) => (
              <li key={document.key} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-text-dark">{document.name}</p>
                  {uploadedOn(document.uploaded_at) ? (
                    <p className="mt-1 text-sm text-text-body">Uploaded {uploadedOn(document.uploaded_at)}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {document.link ? (
                    <a
                      href={document.link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => viewMobile(event, document, Date.now())}
                      className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                    >
                      View<span className="sr-only"> {document.name} from the mobile app (opens in a new tab)</span>
                    </a>
                  ) : (
                    <p className="text-sm text-text-body">{document.has_file ? 'Stored outside TenantVoice' : 'No file'}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <RejectDialog
        key={rejecting ? (rejecting.kind === 'account' ? 'account' : rejecting.document.id) : 'closed'}
        open={rejecting !== null}
        title={rejecting?.kind === 'account' ? 'Reject this account' : 'Reject this document'}
        effect={rejecting?.kind === 'account' ? (
          <p>
            <span className="font-semibold text-text-dark">{name}</span>&apos;s account is not verified, and they are told
            why. It is back in review once they replace or delete a document its verification needs, and each decision
            on one of their documents sets it again from their documents.
          </p>
        ) : (
          <p>
            <span className="font-semibold text-text-dark">{rejecting?.document.label}</span> from {name}. They can replace the
            file to send it for review again.
          </p>
        )}
        confirmLabel={rejecting?.kind === 'account' ? 'Reject account' : 'Reject document'}
        onClose={() => setRejecting(null)}
        onReject={reject}
        returnFocus={() => feedback.current}
      />
    </article>
  );
}
