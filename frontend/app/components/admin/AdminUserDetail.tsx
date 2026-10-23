'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AccountStatusBadge from '@/app/components/admin/AccountStatusBadge';
import UserStatusDialog from '@/app/components/admin/UserStatusDialog';
import DocumentStatusBadge from '@/app/components/documents/DocumentStatusBadge';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import {
  ACCOUNT_STATUS_LABELS,
  adminApi,
  queueRoleOf,
  ROLE_LABELS,
  verificationHref,
  type AccountStatus,
  type AdminProvider,
  type AdminUserDetail as Detail,
  type ProviderStanding,
} from '@/app/lib/admin-api';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatDate } from '@/app/lib/format';
import type { ProfileDocument } from '@/app/lib/profile-documents';

type Loaded = { attempt: number; user: Detail | null; error: string | null; missing: boolean };

const statusLabel = (status: string | null) => (status ? ACCOUNT_STATUS_LABELS[status as AccountStatus] ?? status : 'Unknown');

/**
 * What a status change did, with the clients a provider's suspension told:
 * the notices the server says this change wrote, not the bookings it counts,
 * so a failed notice or another admin's change first is never claimed.
 */
function changeMessage(user: Detail) {
  const done = `${user.full_name || user.email} is now ${statusLabel(user.status).toLowerCase()}.`;
  const told = user.notified ?? 0;
  if (!told) return done;
  return told === 1
    ? `${done} The client of 1 confirmed upcoming booking was sent a notice.`
    : `${done} The clients of ${told} confirmed upcoming bookings were sent a notice.`;
}

/** One account (GET /admin/users/{id}): its details, documents and status history, and its status dialog. */
export default function AdminUserDetail({ userId }: { userId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [openLink, setOpenLink] = useState<{ url: string; name: string } | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const current = loaded?.attempt === attempt ? loaded : null;

  useEffect(() => {
    let active = true;
    adminApi.user(userId).then(
      (user) => { if (active) setLoaded({ attempt, user, error: null, missing: false }); },
      (error) => {
        if (!active) return;
        setLoaded({
          attempt, user: null, missing: error instanceof ApiError && error.status === 404,
          error: error instanceof ApiError ? error.message : 'Please try again.',
        });
      },
    );
    return () => { active = false; };
  }, [attempt, userId]);

  useEffect(() => {
    if (message || documentError || openLink) focusResult(messageRef.current, page.current);
  }, [message, documentError, openLink]);

  function changed(user: Detail) {
    setChanging(false);
    setMessage(changeMessage(user));
    setLoaded((previous) => (previous ? { ...previous, user } : previous));
  }

  function view(document: ProfileDocument) {
    setDocumentError(null);
    setOpenLink(null);
    // Opened inside the click, so a popup blocker lets it through.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    adminApi.documentLink(document.id).then(
      ({ url }) => {
        if (tab && !tab.closed) tab.location.href = url;
        else setOpenLink({ url, name: document.file_name ?? document.label });
      },
      (error) => {
        tab?.close();
        setDocumentError(`${document.label} could not be opened. ${error instanceof ApiError ? error.message : 'Please try again.'}`);
      },
    );
  }

  const user = current?.user;
  // The queue tab this account's documents are decided in; none for staff.
  const queueRole = user ? queueRoleOf(user.role) : null;
  return (
    <div ref={page} className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
      <Link href="/admin/users" className="text-sm font-semibold text-primary-strong underline">← All users</Link>
      {!current ? (
        <p role="status" className="text-sm text-text-body">Loading the account…</p>
      ) : !user ? (
        current.missing ? (
          <Card className="p-6">
            <h1 className="font-heading text-h3 font-semibold">Account not found</h1>
            <p className="mt-2 text-sm text-text-body">No account has this id. It may have been removed.</p>
          </Card>
        ) : (
          <LoadErrorCard title="Couldn't load the account" message={current.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
        )
      ) : (
        <>
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="font-heading text-h2 font-semibold text-text-dark break-words">{user.full_name || user.email}</h1>
              <p className="mt-1 break-all text-sm text-text-body">{user.email}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-body">
                <span>{ROLE_LABELS[user.role] ?? user.role}</span>
                <AccountStatusBadge status={user.status} />
              </p>
            </div>
            <div className="shrink-0">
              {user.status_locked ? (
                <p className="max-w-xs text-sm text-text-body">{user.status_locked}</p>
              ) : (
                <Button variant="secondary" onClick={() => setChanging(true)}>Change status</Button>
              )}
            </div>
          </header>

          <div ref={messageRef} tabIndex={-1}>
            <FormMessage error={documentError} success={message} />
            {openLink ? (
              <p className="text-sm">
                <a href={openLink.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-strong underline">Open {openLink.name}</a>{' '}
                <span className="text-text-body">(the link works for 5 minutes)</span>
              </p>
            ) : null}
          </div>

          <Card className="p-5">
            <h2 className="font-heading text-h4 font-semibold text-text-dark">Account</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Fact label="Phone" value={user.phone || 'Not given'} />
              <Fact label="Joined" value={formatDate(user.created_at)} />
              <Fact label="Roles" value={user.roles.length ? user.roles.map((role) => `${ROLE_LABELS[role.role] ?? role.role}${role.is_primary ? ' (main)' : ''}`).join(', ') : ROLE_LABELS[user.role] ?? user.role} />
              <Fact label="Verification" value={verificationLabel(user.verification_status)} />
              {user.verification.status === 'rejected' && user.verification.rejection_reason ? (
                <Fact
                  label={user.verification.account_rejected ? 'Rejected by an admin' : 'Not verified because'}
                  value={user.verification.rejection_reason}
                />
              ) : null}
              {user.closed_at ? <Fact label="Closed" value={formatDate(user.closed_at)} /> : null}
            </dl>
          </Card>

          {user.provider ? <ProviderFacts provider={user.provider} status={user.status} closed={Boolean(user.closed_at)} /> : null}

          <Card className="p-5">
            <h2 className="font-heading text-h4 font-semibold text-text-dark">Documents</h2>
            {user.documents.length === 0 ? (
              <p className="mt-2 text-sm text-text-body">No documents uploaded.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {user.documents.map((document) => (
                  <li key={document.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-dark">{document.label}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-body">
                        <DocumentStatusBadge status={document.status} />
                        {document.file_name ? <span className="break-all">{document.file_name}</span> : null}
                        <span>Submitted {formatDate(document.submitted_at)}</span>
                      </p>
                      {document.rejection_reason ? <p className="mt-1 text-sm text-danger">Rejected: {document.rejection_reason}</p> : null}
                    </div>
                    {document.can_open ? (
                      <Button variant="secondary" size="sm" className="shrink-0" onClick={() => view(document)}>
                        View<span className="sr-only"> {document.label}</span>
                      </Button>
                    ) : (
                      <p className="text-sm text-text-body">{document.has_file ? 'Stored outside TenantVoice' : 'No file'}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-text-body">
              Each opening is recorded in the audit log.
              {queueRole ? (
                <>
                  {' '}
                  <Link
                    href={verificationHref({ role: queueRole, status: 'PENDING', page: 1 })}
                    className="font-semibold text-primary-strong underline"
                  >
                    Approve or reject documents in the verification queue
                  </Link>
                  .
                </>
              ) : null}
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="font-heading text-h4 font-semibold text-text-dark">Status history</h2>
            {user.status_history.length === 0 ? (
              <p className="mt-2 text-sm text-text-body">No status changes from the admin console.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {user.status_history.map((change, index) => (
                  <li key={`${change.created_at}-${index}`} className="text-sm">
                    <p className="text-text-dark">
                      <span className="font-semibold">{statusLabel(change.from_status)} → {statusLabel(change.to_status)}</span>
                      {' '}by {change.actor_name ?? 'an admin'}, {formatDate(change.created_at)}
                    </p>
                    {change.reason ? <p className="text-text-body">Reason: {change.reason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <UserStatusDialog
            key={changing ? user.id : 'closed'}
            user={changing ? user : null}
            onClose={() => setChanging(false)}
            onChanged={changed}
            returnFocus={() => messageRef.current}
          />
        </>
      )}
    </div>
  );
}

// Whether the verification gates let the provider accept bookings, take on repairs and go live.
const NEW_WORK: Record<ProviderStanding, string> = {
  approved: 'Allowed',
  pending: 'Blocked until the account is verified',
  rejected: 'Blocked until the account is verified',
  unknown: 'Blocked until the account is verified',
  suspended: 'Blocked while the account is suspended',
  inactive: 'Blocked while the account is not active',
};

function listingLabel(provider: AdminProvider, status: AccountStatus, closed: boolean) {
  if (provider.listed) return 'Listed on the marketplace';
  if (!provider.has_profile) return 'Not listed: no provider profile yet';
  if (!provider.published) return 'Not listed: the provider has not gone live';
  return closed ? 'Hidden: the account is closed' : `Hidden while the account is ${statusLabel(status).toLowerCase()}`;
}

/** A provider's place on the marketplace, and the work their status leaves them (tracker R18). */
function ProviderFacts({ provider, status, closed }: { provider: AdminProvider; status: AccountStatus; closed: boolean }) {
  return (
    <Card className="p-5">
      <h2 className="font-heading text-h4 font-semibold text-text-dark">Marketplace</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Fact label="Listing" value={listingLabel(provider, status, closed)} />
        <Fact label="New bookings, repairs and going live" value={NEW_WORK[provider.standing] ?? NEW_WORK.unknown} />
        <Fact label="Confirmed upcoming bookings" value={String(provider.upcoming_bookings)} />
        <Fact label="Jobs in progress" value={String(provider.jobs_in_progress)} />
      </dl>
      <p className="mt-3 text-xs text-text-body">
        Suspending hides the provider from the marketplace and search and stops new bookings, repairs and going live.
        They can still sign in to finish jobs in progress and read past messages and invoices, and the clients of
        their confirmed upcoming bookings are sent a notice. Reactivating lists them again while their profile is
        live; new work still needs a verified account.
      </p>
    </Card>
  );
}

/** users.verification_status as words: "PENDING" reads "Pending". */
function verificationLabel(value: string | null) {
  if (!value) return 'Not reviewed';
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-body">{label}</dt>
      <dd className="break-words font-semibold text-text-dark">{value}</dd>
    </div>
  );
}
