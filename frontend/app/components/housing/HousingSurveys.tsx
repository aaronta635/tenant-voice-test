'use client';

import { useId, useState, type FormEvent } from 'react';
import StatePill, { type PillTone } from '@/app/components/admin/StatePill';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import PageHeader from '@/app/components/ui/PageHeader';
import { ApiError } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';
import { housingApi, type Survey, type SurveyStatus } from '@/app/lib/housing-api';
import { CsvDownloadButton, type HousingColumn } from './HousingTable';
import SurveyPrototypeNotice from './SurveyPrototypeNotice';
import { useHousingData } from './use-housing-data';

const AUDIENCES = ['Tenants', 'Landlords and agents', 'Service providers', 'All members'];
const QUESTION_LIMIT = 20;
const STATUS_TONES: Record<SurveyStatus, PillTone> = { Draft: 'neutral', Live: 'success', Closed: 'info' };
const NEXT_LABELS: Record<SurveyStatus, string> = { Draft: '', Live: 'Go live', Closed: 'Close survey' };

/** closes_at is text: a date the web saved reads in Sydney's format; another app's words stay as they are. */
export function closesLabel(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value || 'Not scheduled';
}

const CSV_COLUMNS: HousingColumn<Survey>[] = [
  { header: 'Survey', value: (row) => row.title },
  { header: 'Audience', value: (row) => row.audience },
  { header: 'Status', value: (row) => row.status },
  { header: 'Questions', value: (row) => row.questions.map((item) => item.text).join(' | ') },
  { header: 'Responses stored', value: (row) => row.responses },
  { header: 'Target responses', value: (row) => row.target_responses },
  { header: 'Closes', value: (row) => closesLabel(row.closes_at) },
];

const fieldClass = 'w-full rounded-lg border border-control-border bg-white px-3 py-2 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong';
const labelClass = 'text-xs font-semibold uppercase tracking-wide text-text-body';

/** A new Draft survey: its title, audience, target, closing date and questions, one per line. */
function NewSurveyForm({ onCreated }: { onCreated: (survey: Survey) => void }) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState(AUDIENCES[0]);
  const [target, setTarget] = useState('1000');
  const [closesOn, setClosesOn] = useState('');
  const [questions, setQuestions] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: string | null; success: string | null }>({ error: null, success: null });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const lines = questions.split('\n').map((line) => line.trim()).filter(Boolean);
    const targetResponses = Number(target);
    const problem = !title.trim() ? 'Give the survey a title.'
      : !lines.length ? 'Add at least one question, one per line.'
        : lines.length > QUESTION_LIMIT ? `Keep it to ${QUESTION_LIMIT} questions.`
          : !Number.isInteger(targetResponses) || targetResponses < 1 ? 'Set a target of at least 1 response.'
            : null;
    if (problem) {
      setMessage({ error: problem, success: null });
      return;
    }
    setBusy(true);
    setMessage({ error: null, success: null });
    try {
      const survey = await housingApi.createSurvey({
        title: title.trim(), audience, target_responses: targetResponses, closes_on: closesOn || null, questions: lines,
      });
      onCreated(survey);
      setTitle('');
      setQuestions('');
      setClosesOn('');
      setMessage({ error: null, success: 'Draft saved. It is sent to nobody; go live when it is ready.' });
    } catch (error) {
      setMessage({ error: error instanceof ApiError ? error.message : 'The survey was not saved. Please try again.', success: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-heading text-h4 font-semibold text-text-dark">New survey</h2>
      <form onSubmit={submit} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <label htmlFor={`${id}-title`} className={labelClass}>Title</label>
          <input id={`${id}-title`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={150} required className={`${fieldClass} min-h-11`} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-audience`} className={labelClass}>Audience</label>
          <select id={`${id}-audience`} value={audience} onChange={(event) => setAudience(event.target.value)} className={`${fieldClass} min-h-11`}>
            {AUDIENCES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-target`} className={labelClass}>Target responses</label>
          <input id={`${id}-target`} type="number" inputMode="numeric" min={1} value={target} onChange={(event) => setTarget(event.target.value)} className={`${fieldClass} min-h-11`} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-closes`} className={labelClass}>Closes on (optional)</label>
          <input id={`${id}-closes`} type="date" value={closesOn} onChange={(event) => setClosesOn(event.target.value)} className={`${fieldClass} min-h-11`} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <label htmlFor={`${id}-questions`} className={labelClass}>Questions, one per line</label>
          <textarea id={`${id}-questions`} value={questions} onChange={(event) => setQuestions(event.target.value)} rows={4} required
            aria-describedby={`${id}-questions-help`} className={fieldClass} />
          <p id={`${id}-questions-help`} className="text-xs text-text-body">Up to {QUESTION_LIMIT} questions of 300 characters each.</p>
        </div>
        <FormMessage className="sm:col-span-2" error={message.error} success={message.success} />
        <div className="sm:col-span-2">
          <Button type="submit" aria-disabled={busy || undefined}>{busy ? 'Saving…' : 'Save draft'}</Button>
        </div>
      </form>
    </Card>
  );
}

function SurveyCard({ survey, onChanged }: { survey: Survey; onChanged: (survey: Survey) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = survey.next_status;

  async function move() {
    if (busy || !next) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await housingApi.setSurveyStatus(survey.id, next, survey.status));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'The survey was not changed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="min-w-0 flex-1 break-words font-heading text-base font-semibold text-text-dark">{survey.title}</h3>
          <StatePill tone={STATUS_TONES[survey.status] ?? 'neutral'}>{survey.status}</StatePill>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div><dt className="inline text-text-body">Audience: </dt><dd className="inline text-text-dark">{survey.audience}</dd></div>
          <div><dt className="inline text-text-body">Closes: </dt><dd className="inline text-text-dark">{closesLabel(survey.closes_at)}</dd></div>
          <div><dt className="inline text-text-body">Responses stored: </dt><dd className="inline text-text-dark">{survey.responses} of {survey.target_responses}</dd></div>
        </dl>
        {survey.questions.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-text-dark">
            {survey.questions.map((item) => <li key={item.id} className="break-words">{item.text}</li>)}
          </ol>
        ) : <p className="text-sm text-text-body">No questions yet.</p>}
        {next ? (
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <Button type="button" variant={next === 'Closed' ? 'secondary' : 'primary'} aria-disabled={busy || undefined} onClick={move}>
              {busy ? 'Saving…' : NEXT_LABELS[next]}<span className="sr-only">: {survey.title}</span>
            </Button>
            {next === 'Live' ? <p className="text-xs text-text-body">Going live sends nothing: surveys are prototypes.</p> : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </Card>
    </li>
  );
}

/** Housing surveys and their questions, Draft to Live to Closed (GET, POST and PATCH /housing/surveys). */
export default function HousingSurveys() {
  const { loading, data, error, retry, replace } = useHousingData(housingApi.surveys);
  const put = (survey: Survey) => replace((items) => (
    items.some((item) => item.id === survey.id) ? items.map((item) => (item.id === survey.id ? survey : item)) : [survey, ...items]
  ));

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Housing surveys"
        description="Build surveys for tenants, landlords and providers. A survey starts as a draft, goes live once and closes once."
        actions={data?.length ? <CsvDownloadButton name="surveys" label="surveys" columns={CSV_COLUMNS} rows={data} /> : null}
      />
      <SurveyPrototypeNotice />
      <NewSurveyForm onCreated={put} />
      {loading ? (
        <p role="status" className="text-sm text-text-body">Loading the surveys…</p>
      ) : !data ? (
        <LoadErrorCard title="Couldn't load the surveys" message={error ?? undefined} onRetry={retry} />
      ) : data.length === 0 ? (
        <p className="text-sm text-text-body">No surveys yet. Save a draft above.</p>
      ) : (
        <section aria-labelledby="housing-surveys-list" className="min-w-0">
          <h2 id="housing-surveys-list" className="font-heading text-h4 font-semibold text-text-dark">Surveys</h2>
          <ul className="mt-3 flex flex-col gap-4">
            {data.map((survey) => <SurveyCard key={survey.id} survey={survey} onChanged={put} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
