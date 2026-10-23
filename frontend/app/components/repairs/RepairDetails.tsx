import Image from 'next/image';
import { formatDate, formatDateTime } from '@/app/lib/format';
import { categoryLabel } from '@/app/lib/repair-categories';
import { isRemoteImage } from '@/app/lib/remote-image';
import {
  priorityLabel,
  repairNextStep,
  REPAIR_STATUS_LABELS,
  REPAIR_STATUS_STYLES,
  type Repair,
} from '@/app/lib/repairs';

type Props = { repair: Repair; viewer: 'tenant' | 'owner' };

/** What a repair is and where it stands, for its tenant or its owner; the page adds the actions. */
export default function RepairDetails({ repair, viewer }: Props) {
  const other = viewer === 'tenant' ? repair.owner_name : repair.tenant_name;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-heading text-lg font-semibold text-text-dark">{repair.title}</h3>
          <p className="mt-1 text-sm text-text-body">
            {repair.category_label ?? categoryLabel(repair.category)} · {priorityLabel(repair.priority)} priority
            {repair.logged_by_owner ? ' · Logged by the owner' : ''}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${REPAIR_STATUS_STYLES[repair.status]}`}>
          {REPAIR_STATUS_LABELS[repair.status]}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-line break-words text-sm text-text-dark">{repair.description}</p>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-semibold text-text-dark">Home</dt>
          <dd className="break-words text-text-body">
            {repair.property_title ?? 'Your home'}
            {repair.property_address ? <span className="block">{repair.property_address}</span> : null}
          </dd>
        </div>
        {other ? (
          <div className="min-w-0">
            <dt className="font-semibold text-text-dark">{viewer === 'tenant' ? 'Owner' : 'Tenant'}</dt>
            <dd className="break-words text-text-body">{other}</dd>
          </div>
        ) : null}
        <div className="min-w-0">
          <dt className="font-semibold text-text-dark">Provider</dt>
          <dd className="break-words text-text-body">{repair.provider_name ?? 'Not assigned yet'}</dd>
        </div>
        {repair.appointment_at ? (
          <div className="min-w-0">
            <dt className="font-semibold text-text-dark">Visit</dt>
            <dd className="text-text-body">{formatDateTime(repair.appointment_at)}</dd>
          </div>
        ) : null}
        {repair.appointment_note ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="font-semibold text-text-dark">Visit note</dt>
            <dd className="whitespace-pre-line break-words text-text-body">{repair.appointment_note}</dd>
          </div>
        ) : null}
        {repair.resolution_note ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="font-semibold text-text-dark">Done {repair.completed_at ? formatDate(repair.completed_at) : ''}</dt>
            <dd className="whitespace-pre-line break-words text-text-body">{repair.resolution_note}</dd>
          </div>
        ) : null}
        <div className="min-w-0 sm:col-span-2">
          <dt className="font-semibold text-text-dark">Reported</dt>
          <dd className="text-text-body">{formatDateTime(repair.created_at)}</dd>
        </div>
      </dl>
      {repair.photo_urls?.length ? (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label={`Photos of ${repair.title}`}>
          {repair.photo_urls.map((url, index) => (
            <li key={url} className="relative size-20 overflow-hidden rounded-lg border border-border bg-background">
              <a href={url} target="_blank" rel="noreferrer" aria-label={`Open photo ${index + 1} of ${repair.title}`}>
                <Image src={url} alt={`Photo ${index + 1} of ${repair.title}`} fill sizes="80px" className="object-cover" unoptimized={isRemoteImage(url)} />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-4 text-sm font-semibold text-text-dark">{repairNextStep(repair, viewer)}</p>
    </div>
  );
}
