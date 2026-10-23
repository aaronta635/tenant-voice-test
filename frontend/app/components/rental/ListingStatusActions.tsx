'use client';

import { useRef, useState } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Modal from '@/app/components/ui/Modal';
import VerificationRequired from '@/app/components/trust/VerificationRequired';
import { api, ApiError, type Property, type SettableListingStatus } from '@/app/lib/api';
import { listingActions, listingStatusNote, listingStatusOf, type ListingAction } from '@/app/lib/listings';
import { verificationRequired, type VerificationRequiredDetail } from '@/app/lib/verification-gate';

// What the page says once a move is saved.
const DONE: Record<SettableListingStatus, string> = {
  published: 'is published: tenants can find it and apply.',
  paused: 'is paused and off the public listings.',
  applications_closed: 'is closed to new applications.',
  leased: 'is marked as leased.',
};

type Props = {
  property: Property;
  onChanged: (updated: Property) => void;
  /** After a delete: the listing is gone from the web. */
  onArchived: () => void;
};

/**
 * The status moves an owner can make from a listing's current status
 * (lib/listings.listingActions): publish, pause, close or reopen
 * applications, and delete. Each says what it does and asks before it
 * changes anything; the API's answer is what the page shows next, and its
 * refusal (a move the database does not allow, one made elsewhere
 * meanwhile, or a delete by someone other than the property's owner) shows
 * in the dialog. Approving an application leases a listing, so the
 * controls say so instead of offering it. Publishing and
 * reopening need a verified account (R18): the server's refusal shows as
 * VerificationRequired in the dialog.
 */
export default function ListingStatusActions({ property, onChanged, onArchived }: Props) {
  const [chosen, setChosen] = useState<ListingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<VerificationRequiredDetail | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const status = listingStatusOf(property);
  const actions = listingActions(status);
  const note = listingStatusNote(status);

  function choose(action: ListingAction) {
    setError(null);
    setGate(null);
    setSuccess(null);
    setChosen(action);
  }

  async function confirm() {
    if (!chosen || busy) return;
    setBusy(true);
    setError(null);
    setGate(null);
    try {
      if (chosen.to === 'archive') {
        await api.properties.remove(property.id);
        setChosen(null);
        onArchived();
        return;
      }
      const updated = await api.properties.update(property.id, { listing_status: chosen.to });
      setChosen(null);
      setSuccess(`${property.title} ${DONE[chosen.to]}`);
      onChanged(updated);
      resultRef.current?.focus();
    } catch (err) {
      const refusal = verificationRequired(err);
      if (refusal) setGate(refusal);
      else setError(err instanceof ApiError ? err.message : 'The listing was not changed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      {note ? <p className="mb-3 max-w-prose text-sm text-text-body">{note}</p> : null}
      <div className="flex flex-wrap gap-2">
        {actions.map((action, index) => (
          <Button
            key={action.to}
            size="sm"
            variant={action.destructive ? 'destructive' : index === 0 ? 'primary' : 'secondary'}
            onClick={() => choose(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>
      <div ref={resultRef} tabIndex={-1} className={success ? 'mt-3' : 'sr-only'}>
        <FormMessage success={success} />
      </div>
      <Modal open={chosen !== null} title={chosen ? `${chosen.label}?` : 'Change the listing'} onClose={() => setChosen(null)} busy={busy}>
        {chosen ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-body">
              <span className="font-semibold text-text-dark">{property.title}</span>: {chosen.effect}
            </p>
            {gate ? <VerificationRequired detail={gate} /> : null}
            <FormMessage error={error} />
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="ghost" disabled={busy} onClick={() => setChosen(null)}>Keep it as it is</Button>
              <Button variant={chosen.destructive ? 'destructive' : 'primary'} disabled={busy} aria-busy={busy} onClick={() => void confirm()}>
                {busy ? 'Saving…' : chosen.label}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
