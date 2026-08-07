import Card from '@/app/components/ui/Card';
import type { Applicant } from '@/app/lib/owner-data';

const STATUS_LABEL: Record<Applicant['status'], string> = {
  new: 'Pending',
  reviewing: 'Pending',
  approved: 'Accepted',
  declined: 'Rejected',
};

const STATUS_BADGE_CLASSES: Record<Applicant['status'], string> = {
  new: 'bg-[#fef3c7] text-[#b45309] border border-[#fde68a]',
  reviewing: 'bg-[#fef3c7] text-[#b45309] border border-[#fde68a]',
  approved: 'bg-[#d1fae5] text-[#047857] border border-[#a7f3d0]',
  declined: 'bg-[#fae8ff] text-[#a21caf] border border-[#f5d0fe]',
};

function initialsOf(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('');
}

export default function ApplicationSummaryCard({ applicant }: { applicant: Applicant }) {
  const scorePercent = Math.round((applicant.tenantScore / 5) * 100);

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-lg font-medium text-primary">
            {initialsOf(applicant.name)}
          </div>
          <div>
            <p className="font-heading text-lg font-semibold text-text-dark">{applicant.name}</p>
            <p className="text-sm text-text-body">Applied {applicant.appliedDate}</p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[applicant.status]}`}
        >
          {applicant.shortlisted ? 'Shortlisted' : STATUS_LABEL[applicant.status]}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-text-body">Score</p>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#f3f4f6]">
              <div className="h-2.5 rounded-full bg-[#10b981]" style={{ width: `${scorePercent}%` }} />
            </div>
            <span className="text-sm font-medium text-text-dark">{scorePercent}</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-text-body">Income</p>
          <p className="mt-2 text-sm font-medium text-text-dark">{applicant.income}</p>
        </div>
        <div>
          <p className="text-xs text-text-body">Pets</p>
          <p className="mt-1 text-sm font-medium text-text-dark">
            {applicant.hasPets ? 'Yes' : 'No'}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-body">Move-in Date</p>
          <p className="mt-1 text-sm font-medium text-text-dark">{applicant.moveInDate}</p>
        </div>
      </div>

      {/* TODO: no real Figma prototype connection for "View Details" — confirm destination with design */}
      <button
        type="button"
        disabled
        className="mt-5 w-full cursor-not-allowed rounded-[10px] border border-border py-3 text-sm font-medium text-text-muted opacity-60"
      >
        View Details
      </button>
    </Card>
  );
}
