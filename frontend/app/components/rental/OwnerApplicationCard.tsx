'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ApplicationHistory from '@/app/components/rental/ApplicationHistory';
import ProfileAvatar from '@/app/components/public-profiles/ProfileAvatar';
import RatingBadge from '@/app/components/trust/RatingBadge';
import VerifiedBadge from '@/app/components/trust/VerifiedBadge';
import Button from '@/app/components/ui/Button';
import FormMessage from '@/app/components/ui/FormMessage';
import Modal from '@/app/components/ui/Modal';
import { api, ApiError, type Application, type ApplicationDocument } from '@/app/lib/api';
import { formatDate, formatMoney } from '@/app/lib/format';
import { APPLICATION_STAGE_LABELS, APPLICATION_STAGE_STYLES, isOpenStage, stageOf } from '@/app/lib/listings';

type Decision = 'approved' | 'declined';

type Props = {
  application: Application;
  listing: { id: string; title: string; price: number };
  onUpdated: (application: Application) => void;
};

const DECISIONS: Record<Decision, { label: string; title: string; done: string }> = {
  approved: { label: 'Approve', title: 'Approve this application?', done: 'Application approved. The applicant has been told, and the listing is now leased.' },
  declined: { label: 'Decline', title: 'Decline this application?', done: 'Application declined. The applicant has been told.' },
};

/**
 * One application on the owner's listing page (R25): who applied, with their
 * verified badge and rating, what they chose to share and the documents they
 * still share, the decision buttons and the history. A note goes to the
 * applicant with an approval or a decline. Only the property's landlord
 * decides (the API refuses an agent or a manager, and says so here), and an
 * approval leases the listing and declines the other open applications.
 */
export default function OwnerApplicationCard({ application, listing, onUpdated }: Props) {
  const router = useRouter();
  const id = useId();
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ url: string; label: string } | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const stage = stageOf(application);
  const name = application.tenant_name || 'Applicant';
  const open = isOpenStage(stage);

  async function act(key: string, work: () => Promise<string | null>, failure: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    setSuccess(null);
    try {
      setSuccess(await work());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
    } finally {
      setBusy(null);
      feedbackRef.current?.focus();
    }
  }

  function shortlist() {
    void act('shortlist', async () => {
      onUpdated(await api.applications.update(application.id, { shortlisted: true }));
      return `${name} is on your shortlist.`;
    }, 'The application was not shortlisted. Please try again.');
  }

  function decide() {
    const decision = deciding;
    if (!decision) return;
    void act(decision, async () => {
      const updated = await api.applications.update(application.id, { status: decision, note: note.trim() || null });
      setDeciding(null);
      setNote('');
      onUpdated(updated);
      return DECISIONS[decision].done;
    }, 'The decision was not saved. Please try again.');
  }

  function openDocument(document: ApplicationDocument) {
    // Open the tab while the click still counts as the person's, so a popup
    // blocker allows it, then send it to the link once it is signed.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    void act(`document-${document.id}`, async () => {
      try {
        const { url } = await api.applications.documentLink(application.id, document.id);
        if (tab && !tab.closed) tab.location.href = url;
        else setOpened({ url, label: document.label });
        return null;
      } catch (err) {
        tab?.close();
        throw err;
      }
    }, 'The document could not be opened. Please try again.');
  }

  function message() {
    void act('message', async () => {
      const conversation = await api.conversations.startRental({ property_id: listing.id, tenant_id: application.tenant_id });
      router.push(`/owner/messages?thread=${conversation.id}`);
      return null;
    }, 'A conversation with this applicant could not be opened.');
  }

  const offer = application.rent_offered;
  return (
    <article aria-labelledby={`${id}-name`} className="min-w-0 rounded-2xl border border-border bg-white p-5">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <ProfileAvatar name={name} url={null} />
          <div className="min-w-0">
            <h3 id={`${id}-name`} className="flex min-w-0 items-center gap-1.5 font-heading text-h4 font-semibold text-text-dark">
              <span className="break-words">{name}</span>
              {application.tenant_verified ? <VerifiedBadge size="sm" /> : null}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-body">
              <RatingBadge average={application.tenant_rating_avg} count={application.tenant_review_count} />
              <span>Applied {formatDate(application.created_at)}</span>
            </div>
          </div>
        </div>
        <span className={`inline-flex items-center rounded-full border bg-white px-2.5 py-0.5 text-xs font-semibold ${APPLICATION_STAGE_STYLES[stage]}`}>
          {APPLICATION_STAGE_LABELS[stage]}
        </span>
      </header>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Detail label="Move-in date" value={application.move_in_date ? formatDate(application.move_in_date) : 'Not given'} />
        <Detail label="People living there" value={application.occupants ? String(application.occupants) : 'Not given'} />
        <Detail label="Pets" value={application.has_pets ? application.pets || 'Yes' : 'No'} />
        <Detail
          label="Offer"
          value={offer != null ? `${formatMoney(offer)} a week${offer === listing.price ? ' (the asking rent)' : ` (asking ${formatMoney(listing.price)})`}` : 'Not given'}
        />
        {application.annual_income != null ? <Detail label="Yearly income" value={formatMoney(application.annual_income)} /> : null}
      </dl>
      {application.about ? <Paragraph label="About them" text={application.about} /> : null}
      {application.message ? <Paragraph label="Message" text={application.message} /> : null}

      <section aria-labelledby={`${id}-documents`} className="mt-4">
        <h4 id={`${id}-documents`} className="text-xs font-semibold uppercase tracking-[0.08em] text-text-body">Shared documents</h4>
        {application.documents?.length ? (
          <ul className="mt-2 space-y-2">
            {application.documents.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                <span className="min-w-0 break-words text-sm text-text-dark">
                  {document.label}
                  {document.verified ? <span className="text-success"> · Verified by TenantVoice</span> : null}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  aria-label={`Open ${document.label} from ${name}`}
                  onClick={() => openDocument(document)}
                >
                  {busy === `document-${document.id}` ? 'Opening…' : 'Open'}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-text-body">
            {open || stage === 'approved' ? 'No documents shared.' : 'Documents are no longer shared once an application is closed.'}
          </p>
        )}
      </section>

      <div ref={feedbackRef} tabIndex={-1} className="mt-3">
        <FormMessage error={error} success={success} />
        {opened ? (
          <p className="text-sm">
            <a href={opened.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-strong underline">
              Open {opened.label}
            </a>{' '}
            <span className="text-text-body">(the link works for 5 minutes)</span>
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        {open && stage !== 'shortlisted' ? (
          <Button variant="secondary" size="sm" disabled={busy !== null} aria-label={`Shortlist ${name}`} onClick={shortlist}>
            {busy === 'shortlist' ? 'Shortlisting…' : 'Shortlist'}
          </Button>
        ) : null}
        {open ? (
          <>
            <Button size="sm" disabled={busy !== null} aria-label={`Approve ${name}`} onClick={() => { setError(null); setDeciding('approved'); }}>
              Approve
            </Button>
            <Button variant="destructive" size="sm" disabled={busy !== null} aria-label={`Decline ${name}`} onClick={() => { setError(null); setDeciding('declined'); }}>
              Decline
            </Button>
          </>
        ) : null}
        <Button variant="ghost" size="sm" disabled={busy !== null} aria-label={`Message ${name}`} onClick={message}>
          {busy === 'message' ? 'Opening…' : 'Message'}
        </Button>
      </div>

      <details className="mt-4">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary-strong">Status history</summary>
        <div className="mt-2">
          <ApplicationHistory history={application.history ?? []} viewer="landlord" applicantName={name} />
        </div>
      </details>

      <Modal
        open={deciding !== null}
        title={deciding ? DECISIONS[deciding].title : 'Decide the application'}
        onClose={() => { setDeciding(null); setNote(''); }}
        busy={busy !== null}
      >
        {deciding ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-body">
              {name} applied for {listing.title}. They are told of your decision, with your note if you add one.
            </p>
            {deciding === 'approved' ? (
              <p className="text-sm text-text-body">
                Approving leases {listing.title}: it leaves the public listings, and every other open application is declined
                and its applicant told. An approval can&apos;t be undone.
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              <label htmlFor={`${id}-note`} className="text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body">
                Note to the applicant (optional)
              </label>
              <textarea
                id={`${id}-note`}
                rows={3}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
              />
            </div>
            <FormMessage error={error} />
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="ghost" disabled={busy !== null} onClick={() => { setDeciding(null); setNote(''); }}>Cancel</Button>
              <Button
                variant={deciding === 'declined' ? 'destructive' : 'primary'}
                disabled={busy !== null}
                aria-busy={busy === deciding}
                onClick={decide}
              >
                {busy === deciding ? 'Saving…' : DECISIONS[deciding].label}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-border py-1.5">
      <dt className="text-text-body">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-text-dark">{value}</dd>
    </div>
  );
}

function Paragraph({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-body">{label}</p>
      <p className="mt-1 whitespace-pre-line break-words text-sm text-text-dark">{text}</p>
    </div>
  );
}
