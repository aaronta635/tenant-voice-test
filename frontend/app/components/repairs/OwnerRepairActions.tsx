'use client';

import { useState, type FormEvent } from 'react';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import VerificationRequired from '@/app/components/trust/VerificationRequired';
import { ApiError } from '@/app/lib/api';
import { repairs, type Repair, type RepairProvider } from '@/app/lib/repairs';
import { verificationRequired, type VerificationRequiredDetail } from '@/app/lib/verification-gate';

type Props = { repair: Repair; onSaved: (repair: Repair) => void };

const fieldClass = 'mt-1.5 w-full min-w-0 rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

/**
 * The owner's steps on a repair: assign a provider who covers its category
 * (the list is the shared database's: approved, active providers only), and
 * mark it resolved at any stage.
 */
export default function OwnerRepairActions({ repair, onSaved }: Props) {
  const [open, setOpen] = useState<'assign' | 'resolve' | null>(null);
  const [providers, setProviders] = useState<RepairProvider[] | null>(null);
  const [providerId, setProviderId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<VerificationRequiredDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function openAssign() {
    setOpen('assign');
    setError(null);
    setGate(null);
    setNotice(null);
    setProviders(null);
    try {
      const list = await repairs.providers(repair.id);
      setProviders(list);
      setProviderId(list[0]?.id ?? '');
    } catch (err) {
      setProviders([]);
      setError(err instanceof ApiError ? err.message : 'The providers could not be loaded. Please try again.');
    }
  }

  async function run(action: () => Promise<Repair>, done: string) {
    setBusy(true);
    setError(null);
    setGate(null);
    try {
      const saved = await action();
      setOpen(null);
      setNote('');
      setNotice(done);
      onSaved(saved);
    } catch (err) {
      const refusal = verificationRequired(err);
      if (refusal) setGate(refusal);
      else setError(err instanceof ApiError ? err.message : 'Could not save this repair. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function assign(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!providerId) {
      setError('Choose a provider.');
      return;
    }
    const name = providers?.find((provider) => provider.id === providerId)?.name ?? 'The provider';
    void run(() => repairs.assign(repair.id, providerId), `${name} has been assigned and told. They book the visit next.`);
  }

  function resolve(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    void run(() => repairs.resolve(repair.id, note.trim() || null), 'Marked resolved. The tenant has been told.');
  }

  return (
    <div className="mt-4">
      {open === 'assign' ? (
        <form onSubmit={assign} noValidate aria-label={`Assign a provider to ${repair.title}`} className="rounded-xl border border-border bg-background p-4">
          {providers === null ? (
            <p role="status" className="text-sm text-text-body">Loading the providers who cover this repair…</p>
          ) : providers.length === 0 && !error ? (
            <p className="text-sm text-text-body">No verified provider covers this category yet. You can still mark the repair resolved yourself.</p>
          ) : providers.length ? (
            <label className="block text-sm font-semibold text-text-dark">
              Provider
              <select value={providerId} onChange={(event) => setProviderId(event.target.value)} disabled={busy} className={fieldClass}>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {[provider.name, provider.service_area, provider.pricing_summary].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {gate ? <VerificationRequired detail={gate} className="mt-3" /> : null}
          <FormMessage error={error} className="mt-3" />
          <div className="mt-3 flex flex-wrap gap-2">
            {providers?.length ? <Button type="submit" disabled={busy}>{busy ? 'Assigning…' : 'Assign provider'}</Button> : null}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(null)}>Cancel</Button>
          </div>
        </form>
      ) : open === 'resolve' ? (
        <form onSubmit={resolve} noValidate aria-label={`Mark ${repair.title} resolved`} className="rounded-xl border border-border bg-background p-4">
          <label className="block text-sm font-semibold text-text-dark">
            Note for the tenant (optional)
            <textarea rows={2} maxLength={1200} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Fixed by our building manager on Tuesday." className={fieldClass} />
          </label>
          <FormMessage error={error} className="mt-3" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Mark resolved'}</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(null)}>Cancel</Button>
          </div>
        </form>
      ) : repair.can_assign || repair.can_resolve ? (
        <div className="flex flex-wrap gap-2">
          {repair.can_assign ? (
            <Button type="button" onClick={() => void openAssign()} aria-label={`${repair.provider_id ? 'Change provider' : 'Assign a provider'} for ${repair.title}`}>
              {repair.provider_id ? 'Change provider' : 'Assign a provider'}
            </Button>
          ) : null}
          {repair.can_resolve ? (
            <Button type="button" variant="secondary" onClick={() => { setOpen('resolve'); setError(null); setNotice(null); }}
              aria-label={`Mark ${repair.title} resolved`}>
              Mark resolved
            </Button>
          ) : null}
        </div>
      ) : null}
      <FormMessage success={notice} className={notice ? 'mt-3' : ''} />
    </div>
  );
}
