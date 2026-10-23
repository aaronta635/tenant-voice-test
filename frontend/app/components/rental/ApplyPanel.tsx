'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ApplicationForm from '@/app/components/rental/ApplicationForm';
import Button from '@/app/components/ui/Button';
import ButtonLink from '@/app/components/ui/ButtonLink';
import FormMessage from '@/app/components/ui/FormMessage';
import Modal from '@/app/components/ui/Modal';
import type { Application, ListingViewer, Property } from '@/app/lib/api';
import { authPageHref } from '@/app/lib/auth-redirect';
import { formatDate } from '@/app/lib/format';
import { APPLICATION_STAGE_LABELS, stageOf } from '@/app/lib/listings';
import { setSearchParams } from '@/app/lib/page-url';

type Props = {
  property: Pick<Property, 'id' | 'title' | 'price' | 'accepting_applications'>;
  viewer: ListingViewer | null | undefined;
  /** The listing page's path, for sign-in to come back to. */
  pathname: string;
  /** Where the tenant's applications are listed. */
  applicationsHref?: string;
  /** Where an owner manages this listing. */
  manageHref: string;
};

// Sign-in comes back with ?apply=1, and the form opens for a tenant who can apply.
const APPLY_PARAM = 'apply';

/**
 * The listing page's Apply card (R25). Signed out it asks the visitor to sign
 * in or create a tenant account and come back; a tenant applies here; one who
 * applied sees where it stands; the landlord of the listing manages it instead.
 */
export default function ApplyPanel({ property, viewer, pathname, applicationsHref = '/tenant/applications', manageHref }: Props) {
  const [applied, setApplied] = useState<Application | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const role = viewer?.role ?? null;
  const ownApplication = viewer?.application ?? null;
  const canApply = role === 'tenant' && !viewer?.is_owner && !ownApplication && !applied && property.accepting_applications === true;

  useEffect(() => {
    // Read once the page is in the browser; the server render has no query here.
    if (!new URLSearchParams(window.location?.search ?? '').has(APPLY_PARAM)) return;
    setSearchParams({ [APPLY_PARAM]: null });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canApply) setOpen(true);
  }, [canApply]);

  const onBusy = useCallback((value: boolean) => setBusy(value), []);

  function submitted(application: Application) {
    setApplied(application);
    setOpen(false);
    setSuccess('Application sent. The landlord will see it with the listing.');
  }

  useEffect(() => {
    if (success) resultRef.current?.focus();
  }, [success]);

  const returnTo = `${pathname}?${APPLY_PARAM}=1`;
  let body;
  if (viewer?.is_owner) {
    body = (
      <>
        <p className="text-sm text-text-body">This is your listing. Applications for it are on your listing page.</p>
        <ButtonLink href={manageHref} fullWidth>Manage listing</ButtonLink>
      </>
    );
  } else if (applied || ownApplication) {
    const stage = applied ? stageOf(applied) : ownApplication!.stage;
    const since = applied ? applied.created_at : ownApplication!.created_at;
    body = (
      <>
        <p className="text-sm text-text-dark">
          You applied on {formatDate(since)}. Status: <span className="font-semibold">{APPLICATION_STAGE_LABELS[stage]}</span>
        </p>
        <ButtonLink href={applicationsHref} variant="secondary" fullWidth>View my applications</ButtonLink>
      </>
    );
  } else if (property.accepting_applications === false) {
    body = <p className="text-sm text-text-body">The landlord isn&apos;t taking new applications for this listing.</p>;
  } else if (role === null) {
    body = (
      <>
        <ButtonLink href={authPageHref('/login', 'tenant', returnTo)} fullWidth>Sign in to apply</ButtonLink>
        <ButtonLink href={authPageHref('/register', 'tenant', returnTo)} variant="secondary" fullWidth>
          Create a free account
        </ButtonLink>
        <p className="text-center text-xs text-text-body">You need a tenant account to apply. It&apos;s free.</p>
      </>
    );
  } else if (role !== 'tenant') {
    body = <p className="text-sm text-text-body">Applications are made from a tenant account.</p>;
  } else {
    body = (
      <>
        <Button fullWidth onClick={() => setOpen(true)}>Apply for this property</Button>
        <p className="text-center text-xs text-text-body">Your saved profile fills in the form. You can change anything before sending.</p>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {body}
      <div ref={resultRef} tabIndex={-1} className={success ? '' : 'sr-only'}>
        <FormMessage success={success} />
      </div>
      {canApply || open ? (
        <Modal open={open} title={`Apply for ${property.title}`} onClose={() => setOpen(false)} busy={busy} className="max-w-2xl">
          <ApplicationForm
            listing={{ id: property.id, title: property.title, price: property.price }}
            onSubmitted={submitted}
            onCancel={() => setOpen(false)}
            onBusy={onBusy}
          />
        </Modal>
      ) : null}
    </div>
  );
}
