import { formatDate, formatDateTime } from '@/app/lib/format';
import { LEASE_STEPS, rentText, stageLabel, STAGE_STYLES, stepsDone, type Lease, type LeaseSignature } from '@/app/lib/leases';

/** The stage as a pill, worded for whoever is looking. */
export function LeaseStagePill({ lease }: { lease: Pick<Lease, 'stage' | 'viewer_role'> }) {
  return (
    <span className={`inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-semibold ${STAGE_STYLES[lease.stage]}`}>
      {stageLabel(lease.stage, lease.viewer_role)}
    </span>
  );
}

/** The six steps of a lease, ticked as far as the server says it has gone. */
export function LeaseSteps({ lease }: { lease: Pick<Lease, 'stage'> }) {
  const done = stepsDone(lease);
  return (
    <ol aria-label="Lease steps" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {LEASE_STEPS.map((step, index) => {
        const state = index < done ? 'done' : index === done ? 'next' : 'later';
        return (
          <li
            key={step.id}
            className={`flex min-w-0 items-center gap-2 rounded-xl border p-3 text-sm ${
              state === 'done' ? 'border-success/40 bg-[#ecfdf3]' : state === 'next' ? 'border-primary-strong/40 bg-[#f0f1ff]' : 'border-border bg-white'
            }`}
          >
            <span aria-hidden className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              state === 'done' ? 'bg-[#1b7c4f] text-white' : 'bg-surface text-text-body'
            }`}>
              {state === 'done' ? '✓' : index + 1}
            </span>
            <span className="min-w-0 break-words text-text-dark">
              {step.label}
              <span className="sr-only">{state === 'done' ? ': done' : state === 'next' ? ': next' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The agreed terms, parties and premises. */
export function LeaseTerms({ lease }: { lease: Lease }) {
  const rows: [string, string][] = [
    ['Home', lease.title],
    ['Address', lease.address ?? '—'],
    ['Tenant', lease.tenant.name],
    ['Owner', lease.owner.name],
    ['Rent', `${rentText(lease.rent_amount, lease.rent_frequency)} (${lease.currency})`],
    ['First payment due', formatDate(lease.first_due_date)],
    ['Starts', formatDate(lease.start_date)],
    ['Ends', lease.end_date ? formatDate(lease.end_date) : 'No end date (continuing)'],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-[0.8px] text-text-body">{label}</dt>
          <dd className="mt-1 break-words text-sm font-medium text-text-dark">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Who signed, when (Sydney time) and the fingerprint of the PDF they signed. */
export function SignatureRecord({ who, signature }: { who: string; signature: LeaseSignature }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4 text-sm">
      <p className="font-semibold text-text-dark">{who} signed as “{signature.signer_name}”</p>
      <p className="mt-1 text-text-body">{formatDateTime(signature.signed_at)} (Sydney time)</p>
      <p className="mt-1 break-all font-mono text-xs text-text-body">SHA-256 {signature.document_sha256}</p>
    </div>
  );
}
