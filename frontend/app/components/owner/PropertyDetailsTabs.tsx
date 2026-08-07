'use client';

import { useState } from 'react';
import Link from 'next/link';
import Button from '@/app/components/ui/Button';
import { api, ApiError, type Application, type ApplicationStatus, type Property } from '@/app/lib/api';
import { formatDate, formatMoney } from '@/app/lib/owner-adapters';

const APPLICANT_STATUS_LABEL: Record<ApplicationStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  approved: 'Approved',
  declined: 'Declined',
};

const APPLICANT_STATUS_CLASSES: Record<ApplicationStatus, string> = {
  new: 'bg-primary/10 text-primary',
  reviewing: 'bg-[#fef3c7] text-[#92400e]',
  approved: 'bg-success/10 text-success',
  declined: 'bg-[#fee2e2] text-[#991b1b]',
};

// "Details" and "Applications" are in-screen tab state in Figma — no route change (see
// docs/navigation-flow.md "Property Details — in-screen tab state"). Only "Analytics" navigates.
type TabId = 'details' | 'applications';

function initialsOf(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}

export default function PropertyDetailsTabs({
  property,
  applications,
  onApplicationsChanged,
}: {
  property: Property;
  applications: Application[];
  onApplicationsChanged: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<TabId>('details');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(application: Application, status: ApplicationStatus) {
    if (pendingId) return;
    setPendingId(application.id);
    setError(null);
    try {
      await api.applications.update(application.id, { status });
      await onApplicationsChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the application.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('details')}
          className={`px-4 py-3 text-sm font-medium ${
            tab === 'details'
              ? 'border-b-2 border-primary text-primary'
              : 'text-text-body hover:text-text-dark'
          }`}
        >
          Details
        </button>
        <button
          type="button"
          onClick={() => setTab('applications')}
          className={`px-4 py-3 text-sm font-medium ${
            tab === 'applications'
              ? 'border-b-2 border-primary text-primary'
              : 'text-text-body hover:text-text-dark'
          }`}
        >
          Applications
        </button>
        <Link
          href={`/owner/properties/${property.id}/analytics`}
          className="px-4 py-3 text-sm font-medium text-text-body hover:text-text-dark"
        >
          Analytics
        </Link>
      </div>

      {tab === 'details' ? (
        <div className="py-6">
          <p className="text-text-body">
            {property.bedrooms ?? 0} bed · {property.bathrooms ?? 0} bath ·{' '}
            {property.parking ?? 0} car · {property.address}
          </p>
          {property.description ? (
            <p className="mt-4 text-text-body">{property.description}</p>
          ) : null}
          {property.amenities && property.amenities.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {property.amenities.map((amenity) => (
                <span
                  key={amenity}
                  className="rounded-full bg-surface px-3 py-1 text-sm font-medium text-text-body"
                >
                  {amenity}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4 py-6">
          {error ? (
            <p className="rounded-xl border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
              {error}
            </p>
          ) : null}
          {applications.length === 0 ? (
            <p className="text-text-body">No applicants yet for this property.</p>
          ) : (
            applications.map((application) => {
              const name = application.tenant_name ?? 'Applicant';
              const isPending =
                application.status === 'new' || application.status === 'reviewing';
              const rowBusy = pendingId === application.id;
              return (
                <div
                  key={application.id}
                  className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-surface text-sm font-bold text-navy">
                      {initialsOf(name)}
                    </div>
                    <div>
                      <p className="font-medium text-text-dark">{name}</p>
                      <p className="text-sm text-text-body">
                        Applied {formatDate(application.created_at)} ·{' '}
                        {formatMoney(application.annual_income, '/yr')}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${APPLICANT_STATUS_CLASSES[application.status]}`}
                    >
                      {APPLICANT_STATUS_LABEL[application.status]}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {isPending ? (
                      <>
                        <Button
                          variant="ghost"
                          className="text-[#de3b40] hover:bg-[#fee2e2]"
                          disabled={rowBusy}
                          onClick={() => setStatus(application, 'declined')}
                        >
                          Decline
                        </Button>
                        <Button
                          variant="primary"
                          disabled={rowBusy}
                          onClick={() => setStatus(application, 'approved')}
                        >
                          Accept
                        </Button>
                      </>
                    ) : (
                      <Link href="/owner/messages">
                        <Button variant="secondary">Message</Button>
                      </Link>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      <Link
        href="/owner/applications"
        className="block rounded-xl border border-border py-3 text-center text-sm font-medium text-primary hover:bg-surface"
      >
        View All {applications.length} Applications
      </Link>
    </div>
  );
}
