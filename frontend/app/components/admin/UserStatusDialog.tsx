'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import AccountStatusBadge from '@/app/components/admin/AccountStatusBadge';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Modal from '@/app/components/ui/Modal';
import { adminApi, type AccountStatus, type AdminUserDetail, type SettableStatus } from '@/app/lib/admin-api';
import { ApiError } from '@/app/lib/api';

/** role is the web role: the dialog says what a change does to a provider's marketplace work. */
export type StatusTarget = { id: string; full_name: string; email: string | null; status: AccountStatus; role?: string };

type Props = {
  /** The account to change; null keeps the dialog closed. Give the dialog a key per account. */
  user: StatusTarget | null;
  onClose: () => void;
  onChanged: (user: AdminUserDetail) => void;
  /** Where focus goes when the dialog closes, if the button that opened it is gone. */
  returnFocus?: () => HTMLElement | null;
};

const REASON_REQUIRED = 'Give a reason for suspending or deactivating an account.';

/** The statuses an account can move to from its own, the likeliest first. */
export function statusChoices(current: AccountStatus): SettableStatus[] {
  const order: SettableStatus[] = current === 'ACTIVE' ? ['SUSPENDED', 'DEACTIVATED'] : ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'];
  return order.filter((status) => status !== current);
}

const isProvider = (user: StatusTarget | null) => user?.role === 'service_provider';

function actionLabel(status: SettableStatus, current: AccountStatus) {
  if (status === 'SUSPENDED') return 'Suspend';
  if (status === 'DEACTIVATED') return 'Deactivate';
  return current === 'SUSPENDED' || current === 'DEACTIVATED' ? 'Reactivate' : 'Activate';
}

const EFFECTS: Record<SettableStatus, string> = {
  SUSPENDED: 'They are locked out from their next action and cannot sign in until an admin reactivates the account.',
  DEACTIVATED: 'They can no longer sign in. An admin can reactivate the account later.',
  ACTIVE: 'They can sign in and use TenantVoice again.',
};
// What the same changes do to a provider (tracker assumption #14): suspended, they still sign in for the work
// under way; reactivated (enabled), they still need a verified account for new work.
// Only a move out of work tells the clients; one already out of work told them then.
const TOLD = 'Clients with confirmed upcoming bookings are told.';
const PROVIDER_EFFECTS: Record<SettableStatus, string> = {
  SUSPENDED:
    'They are hidden from the marketplace and search at once, and get no new bookings or repairs and cannot go live. ' +
    `They can still sign in to finish jobs in progress and read past messages and invoices. ${TOLD}`,
  DEACTIVATED:
    `They can no longer sign in and are hidden from the marketplace. ${TOLD} ` +
    'An admin can reactivate the account later.',
  ACTIVE:
    'They are listed again while their profile is live. Accepting bookings, taking on repairs and going live still ' +
    'need a verified account.',
};

/** What moving a provider to next does, from the status they have now. */
function providerEffect(current: string | null | undefined, next: SettableStatus): string {
  const out = current === 'SUSPENDED' ? 'suspended' : current === 'DEACTIVATED' ? 'deactivated' : null;
  if (!out || next === 'ACTIVE') return PROVIDER_EFFECTS[next];
  return PROVIDER_EFFECTS[next].replace(TOLD, `Clients with confirmed upcoming bookings were told when the account was ${out}.`);
}

/**
 * Suspend, deactivate or reactivate one account. A reason is required unless
 * the account becomes active; the server records it, with the admin and the
 * time, in both audit logs, and refuses the admin's own and staff accounts.
 */
export default function UserStatusDialog({ user, onClose, onChanged, returnFocus }: Props) {
  const id = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [next, setNext] = useState<SettableStatus>(() => statusChoices(user?.status ?? 'ACTIVE')[0]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = user?.full_name || user?.email || 'this account';
  const needsReason = next !== 'ACTIVE';
  const missingReason = error === REASON_REQUIRED;
  const effect = isProvider(user) ? providerEffect(user?.status, next) : EFFECTS[next];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || busy) return;
    if (needsReason && !reason.trim()) {
      setError(REASON_REQUIRED);
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChanged(await adminApi.setStatus(user.id, next, reason));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The status was not changed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <Modal open={user !== null} title={`Change ${name}'s account status`} onClose={onClose} busy={busy} returnFocus={returnFocus}>
      {user ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="flex flex-wrap items-center gap-2 text-sm text-text-body">
            Status now: <AccountStatusBadge status={user.status} />
          </p>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-status`} className="text-xs font-semibold uppercase tracking-wide text-text-body">New status</label>
            <select
              id={`${id}-status`}
              value={next}
              onChange={(event) => { setNext(event.target.value as SettableStatus); setError(null); }}
              className="min-h-11 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
            >
              {statusChoices(user.status).map((status) => (
                <option key={status} value={status}>{actionLabel(status, user.status)}</option>
              ))}
            </select>
            <p className="text-sm text-text-body">{effect}</p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-reason`} className="text-xs font-semibold uppercase tracking-wide text-text-body">
              Reason {needsReason ? '(required)' : '(optional)'}
            </label>
            <textarea
              ref={reasonRef}
              id={`${id}-reason`}
              value={reason}
              onChange={(event) => { setReason(event.target.value); if (missingReason) setError(null); }}
              maxLength={500}
              rows={3}
              required={needsReason}
              aria-invalid={missingReason || undefined}
              aria-describedby={`${id}-reason-help`}
              className="w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
            />
            <p id={`${id}-reason-help`} className="text-xs text-text-body">
              Kept in the audit log with your name and the time. The member is not shown it.
            </p>
          </div>
          <FormMessage error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant={needsReason ? 'destructive' : 'primary'} aria-disabled={busy || undefined}>
              {busy ? 'Saving…' : `${actionLabel(next, user.status)} account`}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
