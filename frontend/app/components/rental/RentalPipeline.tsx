'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import {
  api,
  ApiError,
  safe,
  type Application,
  type Inspection,
  type Profile,
  type Property,
} from '@/app/lib/api';
import { formatDate, formatDateTime, formatMoney } from '@/app/lib/format';

// Stage definitions describe the rental journey (UI flow), while every stage's
// content — properties, inspections, application state — is read from Supabase.
const STAGES = [
  { id: 'browse', label: 'Browse properties', description: 'Compare homes by price, photos, location and availability.', action: 'Select property' },
  { id: 'inspect', label: 'Book inspection', description: 'Request a viewing and ask the owner questions in chat.', action: 'Book inspection' },
  { id: 'apply', label: 'Submit application', description: 'Send your profile, income and move-in date to the owner.', action: 'Submit application' },
  { id: 'review', label: 'Owner review', description: 'The owner reviews your application and can message you.', action: 'Awaiting owner' },
  { id: 'lease', label: 'Lease agreement', description: 'Both sides confirm terms, bond and move-in date.', action: 'Accept lease terms' },
  { id: 'move-in', label: 'Move in', description: 'Keys, condition report, payment setup and ongoing support.', action: 'Confirm move-in' },
] as const;

type StageId = (typeof STAGES)[number]['id'];

/** Where the tenant actually is, derived from their live application record. */
function stageFromApplication(application: Application | undefined): number {
  if (!application) return 0;
  if (application.status === 'approved') return 4;
  if (application.status === 'reviewing') return 3;
  return 2;
}

export default function RentalPipeline() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  // null = follow the live pipeline position; a number = the user picked a step.
  const [stepOverride, setStepOverride] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!selectedPropertyId) return;
    let active = true;
    safe(api.properties.inspections(selectedPropertyId), []).then((list) => {
      if (active) setInspections(list);
    });
    return () => {
      active = false;
    };
  }, [selectedPropertyId]);

  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === selectedPropertyId) ?? null,
    [properties, selectedPropertyId],
  );

  const application = useMemo(
    () => applications.find((app) => app.property_id === selectedPropertyId),
    [applications, selectedPropertyId],
  );

  const currentStep = stageFromApplication(application);
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

  async function advance(stageId: StageId) {
    setError(null);
    setNotice(null);
    if (!selectedPropertyId) return;

    if (stageId === 'inspect') {
      setBusy(true);
      try {
        await api.conversations.startRental({
          property_id: selectedPropertyId,
          subject: selectedProperty?.title ?? null,
          body: 'Hi — I would like to book an inspection for this property.',
        });
        setNotice('Inspection request sent to the owner via Messages.');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not message the owner.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (stageId === 'apply') {
      setBusy(true);
      try {
        const created = await api.applications.create({
          property_id: selectedPropertyId,
          rent_offered: selectedProperty?.price ?? null,
          move_in_date: selectedProperty?.available_from ?? null,
        });
        setApplications((prev) => [created, ...prev]);
        setNotice('Application submitted to the owner.');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not submit that application.');
      } finally {
        setBusy(false);
      }
      return;
    }

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
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-3">
                  {inspections.length === 0 ? (
                    <p className="rounded-[12px] border border-dashed border-[#dee1e6] p-4 text-sm text-[#565d6d]">
                      The owner hasn&apos;t published inspection times yet — message them to
                      arrange one.
                    </p>
                  ) : (
                    inspections.map((slot, index) => (
                      <label
                        key={slot.id}
                        className="flex items-center gap-3 rounded-[12px] border border-[#dee1e6] bg-white p-4"
                      >
                        <input
                          type="radio"
                          name="inspection-time"
                          defaultChecked={index === 0}
                          className="accent-primary"
                        />
                        <span className="font-medium">{formatDateTime(slot.starts_at)}</span>
                      </label>
                    ))
                  )}
                </div>
                <div className="rounded-[14px] bg-[#fafafb] p-5">
                  <h3 className="font-heading text-lg font-semibold">
                    {selectedProperty?.title ?? 'Select a property'}
                  </h3>
                  <p className="mt-2 text-sm text-[#565d6d]">
                    Pick a time, then continue — this opens a conversation with the owner.
                  </p>
                </div>
              </div>
            ) : null}

            {activeStage.id === 'apply' ? (
              <div>
                <div className="grid gap-5 md:grid-cols-2">
                  <ReadOnlyField label="Applicant" value={profile?.full_name ?? '—'} />
                  <ReadOnlyField label="Contact" value={profile?.email ?? '—'} />
                  <ReadOnlyField
                    label="Weekly rent"
                    value={formatMoney(selectedProperty?.price)}
                  />
                  <ReadOnlyField
                    label="Available from"
                    value={formatDate(selectedProperty?.available_from)}
                  />
                </div>
                {application ? (
                  <p className="mt-4 rounded-[10px] bg-[#ecfdf3] px-4 py-3 text-sm font-medium text-[#1b7c4f]">
                    Application submitted {formatDate(application.created_at)} — status:{' '}
                    {application.status}.
                  </p>
                ) : null}
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
                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <Tile
                      label="Tenant score"
                      value={application.tenant_score ? application.tenant_score.toFixed(1) : '—'}
                    />
                    <Tile label="Status" value={application.status} />
                    <Tile label="Shortlisted" value={application.shortlisted ? 'Yes' : 'Not yet'} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeStage.id === 'lease' ? (
              <div className="rounded-[14px] border border-[#dee1e6] bg-white p-5">
                <h3 className="font-heading text-lg font-semibold">Lease agreement summary</h3>
                <dl className="mt-5 grid gap-4 text-sm md:grid-cols-2">
                  <Detail label="Weekly rent" value={formatMoney(selectedProperty?.price)} />
                  <Detail label="Bond" value={formatMoney(selectedProperty?.bond)} />
                  <Detail
                    label="Lease start"
                    value={formatDate(selectedProperty?.available_from)}
                  />
                  <Detail label="Lease term" value={selectedProperty?.lease_term ?? '—'} />
                </dl>
              </div>
            ) : null}

            {activeStage.id === 'move-in' ? (
              <div className="rounded-[14px] border border-[#dee1e6] bg-white p-5 text-sm text-[#565d6d]">
                Keys, condition report and payment setup are arranged directly with the owner —
                use Messages to coordinate.
              </div>
            ) : null}
          </div>

          {error ? <p className="mt-4 text-sm text-[#de3b40]">{error}</p> : null}
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
              <Button
                className="h-10 rounded-[8px]"
                disabled={busy || (activeStage.id === 'apply' && !!application)}
                onClick={() => advance(activeStage.id)}
              >
                {busy ? 'Working…' : activeStage.action}
              </Button>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#565d6d]">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
