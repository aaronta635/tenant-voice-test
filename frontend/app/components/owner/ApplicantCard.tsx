'use client';

import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import type { Applicant } from '@/app/lib/owner-data';

const STATUS_LABEL: Record<Applicant['status'], string> = {
  new: 'Pending',
  reviewing: 'Pending',
  approved: 'Accepted',
  declined: 'Rejected',
};

const STATUS_CLASSES: Record<Applicant['status'], string> = {
  new: 'bg-primary text-white',
  reviewing: 'bg-primary text-white',
  approved: 'border border-border text-text-dark',
  declined: 'border border-[#f3c6c6] text-[#de3b40]',
};

const AVATAR_COLORS = ['bg-[#e0fbed]', 'bg-[#ebfcdd]', 'bg-[#e0f2fe]', 'bg-[#fef3c7]'];

export default function ApplicantCard({
  applicant,
  index = 0,
  onAccept,
  onReject,
  busy = false,
}: {
  applicant: Applicant;
  index?: number;
  onAccept?: (applicant: Applicant) => void;
  onReject?: (applicant: Applicant) => void;
  busy?: boolean;
}) {
  const isPending = applicant.status === 'new' || applicant.status === 'reviewing';

  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <div
          className={`flex size-14 shrink-0 items-center justify-center rounded-full text-sm font-bold text-navy ${AVATAR_COLORS[index % AVATAR_COLORS.length]}`}
        >
          {applicant.name
            .split(' ')
            .map((n) => n[0])
            .join('')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-heading text-lg font-semibold text-text-dark">{applicant.name}</p>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASSES[applicant.status]}`}
            >
              {STATUS_LABEL[applicant.status]}
            </span>
            {applicant.shortlisted ? (
              <span className="rounded-full bg-[#f3f4f6] px-2.5 py-1 text-xs font-medium text-text-dark">
                Shortlist
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-border bg-background/40 p-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-text-body">Property</p>
              <p className="mt-1 text-sm font-medium text-text-dark">{applicant.propertyLabel}</p>
            </div>
            <div>
              <p className="text-xs text-text-body">Email</p>
              <p className="mt-1 text-sm font-medium text-text-dark">{applicant.email}</p>
            </div>
            <div>
              <p className="text-xs text-text-body">Rent Offered</p>
              <p className="mt-1 text-sm font-medium text-text-dark">{applicant.rentOffered}</p>
            </div>
            <div>
              <p className="text-xs text-text-body">Move-in Date</p>
              <p className="mt-1 text-sm font-medium text-text-dark">{applicant.moveInDate}</p>
            </div>
            <div>
              <p className="text-xs text-text-body">Phone</p>
              <p className="mt-1 text-sm font-medium text-text-dark">{applicant.phone}</p>
            </div>
            <div>
              <p className="text-xs text-text-body">Tenant Score</p>
              <p className="mt-1 text-sm font-medium text-text-dark">
                {applicant.tenantScore}/5
                {applicant.tenantScore < 3 ? (
                  <span className="ml-1 text-xs text-text-body">(Review Required)</span>
                ) : null}
              </p>
            </div>
          </div>

          {isPending ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="ghost"
                className="text-[#de3b40] hover:bg-[#fee2e2]"
                disabled={busy}
                onClick={() => onReject?.(applicant)}
              >
                Reject
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => onAccept?.(applicant)}>
                Accept
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
