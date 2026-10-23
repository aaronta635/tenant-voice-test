'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import InspectionBooking from '@/app/components/inspections/InspectionBooking';
import {
  leaseActive,
  PipelineLeaseAction,
  PipelineLeaseStep,
  PipelineMoveInStep,
  usePipelineLease,
} from '@/app/components/leases/PipelineLease';
import ApplicationForm from '@/app/components/rental/ApplicationForm';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import {
  api,
  safe,
  type Application,
  type Profile,
  type Property,
} from '@/app/lib/api';
import { formatDate, formatMoney } from '@/app/lib/format';
import { APPLICATION_STAGE_LABELS, decisionNote, isOpenStage, stageOf } from '@/app/lib/listings';

// Stage definitions describe the rental journey (UI flow), while every stage's
// content — properties, inspections, application state — is read from Supabase.
const STAGES = [
  { id: 'browse', label: 'Browse properties', description: 'Compare homes by price, photos, location and availability.', action: 'Select property' },
  { id: 'inspect', label: 'Book inspection', description: 'Ask for one of the inspection times the owner published. They accept it, decline it or ask you to pick another.', action: 'Book an inspection' },
  { id: 'apply', label: 'Submit application', description: 'Send the owner what you choose to share: your saved profile fills in the form.', action: 'Submit application' },
  { id: 'review', label: 'Owner review', description: 'The owner reviews your application and can message you.', action: 'Awaiting owner' },
  { id: 'lease', label: 'Lease agreement', description: 'Review the lease your owner sends, confirm its terms and sign it. Your owner signs it next and activates it.', action: 'Review the lease' },
  { id: 'move-in', label: 'Move in', description: 'Once the lease is active: keys, the condition report and your first rent payment.', action: 'View the lease' },
] as const;

/** Where the tenant actually is, derived from their live application record. */
function stageFromApplication(application: Application | undefined): number {
  if (!application) return 0;
  const stage = stageOf(application);
  if (stage === 'approved') return 4;
  // Sent and waiting on the owner; a declined or closed one is back at applying.
  return isOpenStage(stage) ? 3 : 2;
}

/** An approved application waits at the lease until the server says the owner activated it. */
const LEASE_STEP = 4;
const MOVE_IN_STEP = 5;

export default function RentalPipeline() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  // null = follow the live pipeline position; a number = the user picked a step.
  const [stepOverride, setStepOverride] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [propertyList, applicationList, me] = await Promise.all([
        safe(api.properties.listPublic({ limit: 12 }), []),
        safe(api.applications.listMine(), []),
        safe<Profile | null>(api.profiles.me(), null),
      ]);
      if (!active) return;
      setProperties(propertyList);
      setApplications(applicationList);
      setProfile(me);
      const initial = applicationList[0]?.property_id ?? propertyList[0]?.id ?? null;
      setSelectedPropertyId(initial);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === selectedPropertyId) ?? null,
    [properties, selectedPropertyId],
  );

  const application = useMemo(
    () => applications.find((app) => app.property_id === selectedPropertyId),
    [applications, selectedPropertyId],
  );

  const approved = application !== undefined && stageOf(application) === 'approved';
  const leaseState = usePipelineLease(approved && application ? application.id : null);
  const applicationStep = stageFromApplication(application);
  const currentStep = applicationStep === LEASE_STEP && leaseActive(leaseState.lease) ? MOVE_IN_STEP : applicationStep;
  const selectedStep = stepOverride ?? currentStep;
  const setSelectedStep = (next: number | ((step: number) => number)) =>
    setStepOverride((prev) =>
      typeof next === 'function' ? next(prev ?? currentStep) : next,
    );

  const enrichedStages = STAGES.map((stage, index) => ({
    ...stage,
    status: index < currentStep ? 'done' : index === currentStep ? 'current' : 'next',
  }));

  const activeStage = enrichedStages[selectedStep];
  const progress = Math.round(((currentStep + 1) / enrichedStages.length) * 100);

  function advance() {
    setNotice(null);
    if (!selectedPropertyId) return;
    setSelectedStep((step) => Math.min(step + 1, enrichedStages.length - 1));
  }

  if (loading) return <p className="text-[#565d6d]">Loading your rental pipeline…</p>;

  if (properties.length === 0) {
    return (
      <Card className="rounded-[16px] border border-[#dee1e6] p-8 text-center">
        <h2 className="font-heading text-xl font-semibold">No properties listed yet</h2>
        <p className="mt-2 text-sm text-[#565d6d]">
          Once owners publish listings they appear here and drive the pipeline.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="h-fit rounded-[16px] border border-[#dee1e6] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-xl font-bold">Rental pipeline</h2>
            <p className="mt-1 text-sm text-[#565d6d]">{progress}% complete</p>
          </div>
        </div>

        <div className="mt-5 h-2 rounded-full bg-[#e5e7eb]">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-6 space-y-3">
          {enrichedStages.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedStep(index)}
              className={`flex w-full items-start gap-3 rounded-[12px] border p-3 text-left transition ${
                selectedStep === index
                  ? 'border-primary bg-[#f0f1ff]'
                  : 'border-[#dee1e6] bg-white hover:border-primary/30'
              }`}
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  item.status === 'done'
                    ? 'bg-primary text-white'
                    : item.status === 'current'
                      ? 'bg-[#f0f1ff] text-primary ring-1 ring-primary'
                      : 'bg-[#f3f4f6] text-[#565d6d]'
                }`}
              >
                {item.status === 'done' ? '✓' : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{item.label}</span>
                <span className="mt-1 block text-xs capitalize text-[#565d6d]">{item.status}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <div className="space-y-6">
        <Card className="rounded-[16px] border border-[#dee1e6] p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                Step {selectedStep + 1} of {enrichedStages.length}
              </p>
              <h1 className="mt-2 font-heading text-3xl font-bold">{activeStage.label}</h1>
              <p className="mt-2 text-[#565d6d]">{activeStage.description}</p>
            </div>
            <StatusBadge status={activeStage.status} />
          </div>

          <div className="mt-8">
            {activeStage.id === 'browse' ? (
              <div className="grid gap-4 md:grid-cols-3">
                {properties.slice(0, 6).map((property) => (
                  <button
                    key={property.id}
                    type="button"
                    onClick={() => setSelectedPropertyId(property.id)}
                    className={`rounded-[14px] border bg-white p-4 text-left transition ${
                      selectedPropertyId === property.id
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-[#dee1e6] hover:border-primary/40'
                    }`}
                  >
                    <p className="font-bold">{property.title}</p>
                    <p className="mt-1 text-sm text-[#565d6d]">
                      {property.suburb ?? property.address}
                    </p>
                    <p className="mt-4 font-heading text-2xl font-bold text-primary">
                      {formatMoney(property.price)}
                    </p>
                    <p className="text-xs text-[#565d6d]">per week</p>
                  </button>
                ))}
              </div>
            ) : null}

            {activeStage.id === 'inspect' ? (
              <div className="rounded-[14px] border border-[#dee1e6] bg-white p-5">
                <h3 className="font-heading text-lg font-semibold">
                  {selectedProperty?.title ?? 'Select a property'}
                </h3>
                {selectedPropertyId ? (
                  <InspectionBooking
                    key={selectedPropertyId}
                    propertyId={selectedPropertyId}
                    role="tenant"
                    isOwner={false}
                    signInHref="/login?role=tenant"
                    manageHref="/owner/properties"
                  />
                ) : (
                  <p className="mt-2 text-sm text-[#565d6d]">Choose a property in the first step to book an inspection.</p>
                )}
              </div>
            ) : null}

            {activeStage.id === 'apply' ? (
              <div>
                <div className="grid gap-5 md:grid-cols-2">
                  <ReadOnlyField label="Applicant" value={profile?.full_name ?? '—'} />
                  <ReadOnlyField
                    label="Weekly rent"
                    value={formatMoney(selectedProperty?.price)}
                  />
                </div>
                {application ? (
                  <p className="mt-4 rounded-[10px] bg-[#ecfdf3] px-4 py-3 text-sm font-medium text-[#1b7c4f]">
                    Application submitted {formatDate(application.created_at)} — status:{' '}
                    {APPLICATION_STAGE_LABELS[stageOf(application)]}.{' '}
                    <Link href="/tenant/applications" className="underline">View my applications</Link>
                  </p>
                ) : selectedProperty ? (
                  <div className="mt-5 rounded-[14px] border border-[#dee1e6] p-5">
                    <ApplicationForm
                      key={selectedProperty.id}
                      listing={{ id: selectedProperty.id, title: selectedProperty.title, price: selectedProperty.price }}
                      onSubmitted={(created) => {
                        setApplications((prev) => [created, ...prev]);
                        setNotice('Application submitted to the owner.');
                      }}
                    />
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-[#565d6d]">Choose a property in the first step to apply for it.</p>
                )}
              </div>
            ) : null}

            {activeStage.id === 'review' ? (
              <div className="rounded-[14px] border border-[#dee1e6] bg-white p-5">
                <h3 className="font-heading text-lg font-semibold">Owner review</h3>
                <p className="mt-2 text-sm text-[#565d6d]">
                  The owner reviews your application for{' '}
                  {selectedProperty?.title ?? 'this property'} and can message you for
                  clarifications.
                </p>
                {application ? (
                  <>
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      <Tile label="Status" value={APPLICATION_STAGE_LABELS[stageOf(application)]} />
                      <Tile label="Shortlisted" value={application.shortlisted ? 'Yes' : 'Not yet'} />
                    </div>
                    {decisionNote(application) ? (
                      <p className="mt-4 whitespace-pre-line break-words rounded-[10px] bg-[#fafafb] p-4 text-sm text-[#171a1f]">
                        From the owner: {decisionNote(application)}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {activeStage.id === 'lease' ? <PipelineLeaseStep state={leaseState} approved={approved} /> : null}

            {activeStage.id === 'move-in' ? <PipelineMoveInStep state={leaseState} /> : null}
          </div>

          {notice ? (
            <p className="mt-4 rounded-[10px] bg-[#ecfdf3] px-4 py-3 text-sm font-medium text-[#1b7c4f]">
              {notice}
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#f1f5f9] pt-6">
            <Button
              variant="ghost"
              className="h-10 rounded-[8px]"
              disabled={selectedStep === 0}
              onClick={() => setSelectedStep((step) => Math.max(0, step - 1))}
            >
              Previous
            </Button>
            <div className="flex flex-wrap gap-3">
              <Link href="/tenant/messages">
                <Button variant="secondary" className="h-10 rounded-[8px]">
                  Message owner
                </Button>
              </Link>
              {/* Applying and booking are the form's and the booking panel's own buttons;
                  the lease steps move only with the lease itself. */}
              {activeStage.id === 'lease' || activeStage.id === 'move-in' ? (
                <PipelineLeaseAction lease={leaseState.lease} />
              ) : activeStage.id === 'apply' || activeStage.id === 'inspect' ? null : (
                <Button className="h-10 rounded-[8px]" onClick={advance}>
                  {activeStage.action}
                </Button>
              )}
            </div>
          </div>
        </Card>

        {selectedProperty ? (
          <Card className="rounded-[16px] border border-[#dee1e6] p-6">
            <h2 className="font-heading text-xl font-bold">Selected rental</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="font-bold">{selectedProperty.title}</p>
                <p className="mt-1 text-sm text-[#565d6d]">{selectedProperty.address}</p>
                <p className="mt-2 text-sm text-[#565d6d]">
                  {formatMoney(selectedProperty.price)}/week · Bond{' '}
                  {formatMoney(selectedProperty.bond)}
                </p>
              </div>
              <Link href={`/tenant/properties/${selectedProperty.id}`}>
                <Button variant="secondary" className="h-10 rounded-[8px]">
                  View property
                </Button>
              </Link>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === 'done'
      ? 'bg-[#ecfdf3] text-[#1b7c4f]'
      : status === 'current'
        ? 'bg-[#f0f1ff] text-primary'
        : 'bg-[#f3f4f6] text-[#565d6d]';

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${classes}`}>
      {status}
    </span>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#565d6d]">
        {label}
      </p>
      <p className="mt-1 rounded-[8px] border border-[#dee1e6] bg-[#fafafb] px-3 py-2.5 text-sm font-medium">
        {value}
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] bg-[#fafafb] p-4 text-sm">
      <p className="text-xs text-[#565d6d]">{label}</p>
      <p className="mt-1 font-semibold capitalize">{value}</p>
    </div>
  );
}
