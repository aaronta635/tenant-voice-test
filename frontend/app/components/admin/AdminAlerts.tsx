'use client';

import { useEffect, useRef, useState } from 'react';
import ComplaintsSectionNav from '@/app/components/admin/ComplaintsSectionNav';
import ReasonDialog from '@/app/components/admin/ReasonDialog';
import StatePill from '@/app/components/admin/StatePill';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import { ALERT_STATUS_LABELS, adminAlertsApi, type AdminAlert } from '@/app/lib/admin-alerts-api';
import { ApiError } from '@/app/lib/api';
import { focusResult } from '@/app/lib/focus-result';
import { formatDateTime } from '@/app/lib/format';

type Loaded = { attempt: number; alerts: AdminAlert[] | null; error: string | null };

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The admin alerts (GET /admin/alerts): unresolved complaints an alert
 * policy covers that passed its response time, or repeat at a property or
 * across an owner's properties. The list is worked out again on every load.
 * A critical alert can be referred to the Housing Portal with its evidence
 * package; referring it again updates the package.
 */
export default function AdminAlerts() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [referring, setReferring] = useState<AdminAlert | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const current = loaded?.attempt === attempt ? loaded : null;
  const alerts = current?.alerts ?? loaded?.alerts ?? null;

  useEffect(() => {
    let active = true;
    adminAlertsApi.list().then(
      (found) => { if (active) setLoaded({ attempt, alerts: found, error: null }); },
      (error) => { if (active) setLoaded({ attempt, alerts: null, error: error instanceof ApiError ? error.message : 'Please try again.' }); },
    );
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => { if (message) focusResult(messageRef.current, pageRef.current); }, [message]);

  const critical = alerts?.filter((alert) => alert.severity === 'CRITICAL').length ?? 0;
  return (
    <div ref={pageRef} className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Alerts"
        description="Unresolved complaints past their alert policy's response time, or repeating at a property or across an owner's properties. Refer a critical one to the Housing Portal with its evidence."
        actions={alerts ? <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Refresh</Button> : undefined}
      />
      <ComplaintsSectionNav current="alerts" />

      <div ref={messageRef} tabIndex={-1}>
        <FormMessage error={message?.error ? message.text : null} success={message && !message.error ? message.text : null} />
      </div>

      <section aria-labelledby="alerts-heading" aria-busy={!current} className="min-w-0">
        <h2 id="alerts-heading" className="font-heading text-h4 font-semibold text-text-dark">
          {alerts ? `${plural(alerts.length, 'alert', 'alerts')}${critical ? `, ${critical} critical` : ''}` : 'Alerts'}
        </h2>
        {!alerts && !current ? (
          <div role="status" aria-label="Loading the alerts" className="mt-3 space-y-3">
            {[0, 1].map((index) => <div key={index} aria-hidden className="h-28 animate-pulse rounded-2xl border border-border bg-white" />)}
          </div>
        ) : !alerts ? (
          <div className="mt-3">
            <LoadErrorCard title="Couldn't load the alerts" message={current?.error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} />
          </div>
        ) : alerts.length === 0 ? (
          <Card className="mt-3 p-6">
            <p className="text-sm text-text-body">No alerts. Every complaint an active policy covers is within its limits.</p>
          </Card>
        ) : (
          <ul className="mt-3 space-y-3">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <AlertCard alert={alert} onRefer={() => setReferring(alert)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReasonDialog
        key={referring?.id ?? 'none'}
        open={referring !== null}
        title={referring?.status === 'ESCALATED' ? 'Update the referral' : 'Refer to the Housing Portal'}
        effect={(
          <p>
            {referring?.status === 'ESCALATED'
              ? 'The referral package is prepared again with the latest evidence and this note.'
              : 'A referral package with the complaint, the property, the parties and the evidence goes to the Housing Portal, and the housing officers are told.'}
          </p>
        )}
        confirmLabel={referring?.status === 'ESCALATED' ? 'Update the referral' : 'Refer'}
        tone="primary"
        reasonHelp="Kept with the referral package and in the audit log, with your name and the time."
        onClose={() => setReferring(null)}
        onConfirm={async (note) => {
          if (!referring) return null;
          try {
            const result = await adminAlertsApi.escalate(referring.id, note);
            setReferring(null);
            setMessage({
              text: `${referring.title} was referred to the Housing Portal${result.case_reference ? ` as ${result.case_reference}` : ''}.`,
              error: false,
            });
            setAttempt((value) => value + 1);
            return null;
          } catch (error) {
            return error instanceof ApiError ? error.message : 'The alert was not referred. Please try again.';
          }
        }}
        returnFocus={() => messageRef.current}
      />
    </div>
  );
}

function AlertCard({ alert, onRefer }: { alert: AdminAlert; onRefer: () => void }) {
  const isCritical = alert.severity === 'CRITICAL';
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-words font-heading text-base font-semibold text-text-dark">{alert.title}</h3>
        <StatePill tone={isCritical ? 'danger' : 'warning'}>{isCritical ? 'Critical' : 'High'}</StatePill>
        <StatePill tone={alert.status === 'ESCALATED' ? 'info' : 'neutral'}>{ALERT_STATUS_LABELS[alert.status] ?? alert.status}</StatePill>
      </div>
      <p className="break-words text-sm text-text-dark">{alert.reason}</p>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-body">
        {alert.address ? <span className="break-words">{alert.address}</span> : null}
        <span>Open {plural(alert.days_open, 'day', 'days')}</span>
        <span>{plural(alert.property_open_complaints, 'open complaint', 'open complaints')} at the property</span>
        <span>{plural(alert.owner_open_complaints, 'open complaint', 'open complaints')} for the owner</span>
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-body">
        {alert.category_name ? <span>Policy: {alert.category_name}</span> : null}
        {alert.routing_team ? <span className="break-words">{alert.routing_team}</span> : null}
        {alert.photo_count ? <span>{plural(alert.photo_count, 'photo', 'photos')}</span> : null}
        {/* mobile_admin_alerts reads it from the repair's tenant only: false says nothing about a complaint without one. */}
        {alert.documents_verified ? <span>Repair tenant verified</span> : null}
      </p>
      {alert.escalated_at ? (
        <p className="break-words text-sm text-text-body">
          Referred <time dateTime={alert.escalated_at}>{formatDateTime(alert.escalated_at)}</time>
          {alert.escalation_note ? `: ${alert.escalation_note}` : ''}
        </p>
      ) : null}
      {isCritical ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" onClick={onRefer}>
            {alert.status === 'ESCALATED' ? 'Update the referral' : 'Refer to the Housing Portal'}<span className="sr-only">: {alert.title}</span>
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
