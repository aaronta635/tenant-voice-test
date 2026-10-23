import Link from 'next/link';
import { mergeClasses } from '@/app/components/ui/merge-classes';
import type { VerificationRequiredDetail } from '@/app/lib/verification-gate';

type Props = {
  /** The refusal, from verificationRequired(error) (lib/verification-gate). */
  detail: VerificationRequiredDetail;
  /** For a caller that moves focus to it (lib/focus-result); it is focusable from script only. */
  id?: string;
  className?: string;
};

const HEADINGS: Record<string, string> = {
  pending: 'Verification needed',
  rejected: 'A document needs replacing',
  unknown: 'Verification needed',
  suspended: 'Account suspended',
  inactive: 'Account not active',
  unverified: 'Not verified yet',
  unavailable: 'Not available',
};

/**
 * Says why a verification gate refused an action (backend services/gates.py,
 * tracker R18): applying, publishing a listing, paid AI, accepting a booking,
 * taking on a repair or going live needs an active, verified account. It
 * shows the server's sentence, and a link to the person's documents while
 * documents can change the answer. Rendered in place of the error an action
 * would otherwise show, so it is an alert.
 */
export default function VerificationRequired({ detail, id, className }: Props) {
  return (
    <div id={id} tabIndex={-1} role="alert" className={mergeClasses('rounded-xl border border-warning bg-white p-4 text-sm', className)}>
      <p className="font-semibold text-text-dark">{HEADINGS[detail.status] ?? 'Verification needed'}</p>
      <p className="mt-1 text-text-body">{detail.message}</p>
      {detail.documents_href ? (
        <Link href={detail.documents_href} className="mt-2 inline-flex min-h-11 items-center font-semibold text-primary-strong underline">
          Go to your documents
        </Link>
      ) : null}
    </div>
  );
}
