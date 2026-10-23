import { useId } from 'react';
import DocumentStatusBadge from '@/app/components/documents/DocumentStatusBadge';
import { VERIFICATION_LABELS, type AccountVerification, type DocumentRequirement } from '@/app/lib/profile-documents';

type Props = {
  requirements: DocumentRequirement[];
  met: boolean;
  /** The account's verification, which the verified badge reads. */
  account: AccountVerification;
  /** A document type's label, to say which types meet a requirement. */
  typeLabel: (type: string) => string;
};

/** "or"-joined, lower case after the first: "Passport, driver licence or photo ID card". */
function anyOf(labels: string[]) {
  const words = labels.map((label, index) => (index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1)));
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : (words[0] ?? '');
}

/** What this role's verification needs, how far each requirement is, and what TenantVoice decided on the account. */
export default function RequirementsSummary({ requirements, met, account, typeLabel }: Props) {
  const id = useId();
  if (!requirements.length) return null;
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={id} className="font-heading text-h4 font-semibold text-text-dark">What verification needs</h2>
        <p className="flex items-center gap-2 text-sm text-text-body">
          Your account <DocumentStatusBadge status={account.status} label={VERIFICATION_LABELS[account.status]} />
        </p>
      </div>
      <p className="mt-1 text-sm text-text-body">
        A TenantVoice admin reviews each document. Your account is verified once every document below is.
      </p>
      <ul className="mt-4 divide-y divide-border">
        {requirements.map((requirement) => {
          const accepted = anyOf(requirement.types.map(typeLabel));
          return (
            <li key={requirement.key} className="flex flex-col items-start gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-dark">{requirement.label}</p>
                {/* Said once when the accepted types are the requirement's own name. */}
                {accepted.toLowerCase() !== requirement.label.toLowerCase() ? <p className="text-sm text-text-body">{accepted}</p> : null}
              </div>
              <DocumentStatusBadge status={requirement.status} />
            </li>
          );
        })}
      </ul>
      <div role="status" className="mt-3 text-sm text-text-body">
        {account.status === 'verified' ? (
          <p>Your account is verified, so your profile shows the verified badge.</p>
        ) : account.status === 'rejected' ? (
          <>
            <p className="text-danger">
              <span className="font-semibold">
                {account.account_rejected ? 'TenantVoice did not verify your account. ' : 'Your account is not verified. '}
              </span>
              {account.rejection_reason ? `Reason: ${account.rejection_reason}` : null}
            </p>
            <p className="mt-1">
              {account.account_rejected
                ? 'Replace a document verification needs to ask for another review.'
                : 'Replace the documents marked Rejected to send them for review again.'}
            </p>
          </>
        ) : (
          <p>
            {met
              ? 'Every required document is verified. TenantVoice will confirm your account shortly.'
              : 'Your profile shows the verified badge once a TenantVoice admin approves these.'}
          </p>
        )}
      </div>
    </section>
  );
}
